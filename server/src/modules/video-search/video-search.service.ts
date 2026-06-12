import fs from 'node:fs';
import path from 'node:path';
import type { MediaView } from '@socialsim/shared';
import { config } from '../../config.js';
import { AppError } from '../../core/errors/app-error.js';
import type { WorldManager } from '../../core/world/world-manager.js';
import { deriveEmbed, type EmbedSite } from '../link-cards/embed.js';
import type { MediaService } from '../media/media.service.js';
import { readSearchConfig, videoSettings } from '../media-search/search-config.js';
import type { ToolsService } from '../tools/tools.service.js';
import { VideoTaskError, VideoTaskManager, type VideoTask, type VideoTaskView } from './video-tasks.js';
import { YtDlp } from './ytdlp.js';

/** 成人站域名清单：contentRating!=='all' 的世界拒绝引入（D/E 期搜索源沿用同清单） */
const ADULT_HOSTS = ['pornhub.com', 'rule34video.com'];

export type IngestMode = 'auto' | 'download' | 'stream';

export interface IngestResult {
  /** auto 命中嵌入卡：不建任务，调用方把 URL 留在正文走链接卡 */
  embed?: { embedUrl: string; site: EmbedSite };
  task?: VideoTaskView;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    throw new AppError(400, 'VALIDATION', '链接格式不正确');
  }
}

function isAdultHost(host: string): boolean {
  return ADULT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

export class VideoSearchService {
  private readonly ytdlp: YtDlp;
  readonly tasks = new VideoTaskManager();

  constructor(
    private readonly worldManager: WorldManager,
    toolsService: ToolsService,
    private readonly mediaService: MediaService,
  ) {
    this.ytdlp = new YtDlp(toolsService);
    // 有任务在执行时拒绝覆盖二进制（Windows 文件锁）
    toolsService.setBusyCheck(() => this.tasks.hasRunning());
  }

  /**
   * 引入外站视频。mode='auto' 时服务端按形态路由裁决：
   * 可嵌入站点默认走嵌入卡（不建任务）；siteModes 覆盖为 download/stream 则建任务；
   * 非可嵌入站点按全局 defaultMode。显式 mode 无条件按指定模式。
   */
  ingest(userId: number, url: string, mode: IngestMode): IngestResult {
    const host = hostOf(url);
    const settings = videoSettings(readSearchConfig());

    let resolved: 'download' | 'stream';
    if (mode === 'auto') {
      const emb = deriveEmbed(url);
      if (emb) {
        const siteMode = settings.siteModes[emb.site] ?? 'embed';
        if (siteMode === 'embed') return { embed: { embedUrl: emb.embedUrl, site: emb.site } };
        resolved = siteMode;
      } else {
        resolved = settings.defaultMode;
      }
    } else {
      resolved = mode;
    }

    if (resolved === 'stream') {
      throw new AppError(400, 'NOT_IMPLEMENTED', '流式引用尚未开放（周期 D 提供）');
    }
    if (!this.ytdlp.available()) {
      throw new AppError(400, 'TOOL_MISSING', 'yt-dlp 未安装，请到设置页"视频工具"安装');
    }
    const { worldId, meta, clock } = this.worldManager.current();
    if (isAdultHost(host) && meta.contentRating !== 'all') {
      throw new AppError(400, 'RATING_BLOCKED', '当前世界的内容分级不允许引入该站点的视频');
    }

    const task = this.tasks.enqueue(
      userId,
      worldId,
      { url, mode: resolved, createdAt: clock.now() },
      (t) => this.runDownload(t),
    );
    return { task };
  }

  /** 下载模式执行流：probe → 同源去重 → 下载 → 世界核对 → 入库 → 海报（非致命） */
  private async runDownload(task: VideoTask): Promise<MediaView> {
    const cfg = readSearchConfig();
    const settings = videoSettings(cfg);
    const proxy = cfg.proxy?.trim() || undefined;
    const signal = task.abort.signal;

    const probe = await this.ytdlp.probe(task.url, proxy, signal).catch((err: Error) => {
      throw new VideoTaskError('URL_UNSUPPORTED', `无法解析该链接：${err.message}`);
    });
    task.title = probe.title;
    const originUrl = probe.webpageUrl || task.url;
    if (probe.filesizeApprox !== null && probe.filesizeApprox > settings.maxBytes * 1.2) {
      throw new VideoTaskError(
        'TOO_LARGE',
        `视频约 ${Math.round(probe.filesizeApprox / 1024 / 1024)}MB，超出 ${Math.round(settings.maxBytes / 1024 / 1024)}MB 上限`,
      );
    }

    // 同源去重：已有同 origin_url 的入库视频则复用，不重复下载字节
    this.assertWorld(task);
    const reused = this.mediaService.reuseVideoByOrigin(task.userId, originUrl);
    if (reused) {
      task.progress = 100;
      return reused;
    }

    task.status = 'downloading';
    const outDir = path.join(config.dataDir, 'tmp', 'video', task.id);
    try {
      const result = await this.ytdlp.download(
        originUrl,
        { maxHeight: settings.maxHeight, maxBytes: settings.maxBytes, outDir, proxy },
        (pct, totalBytes) => {
          task.progress = Math.min(99, Math.round(pct));
          task.totalBytes = totalBytes;
        },
        signal,
      );
      if (result.sizeBytes > settings.maxBytes) {
        throw new VideoTaskError(
          'TOO_LARGE',
          `视频 ${Math.round(result.sizeBytes / 1024 / 1024)}MB，超出 ${Math.round(settings.maxBytes / 1024 / 1024)}MB 上限`,
        );
      }
      this.assertWorld(task);
      let view = this.mediaService.createVideoFromFile(task.userId, result.filePath, {
        width: probe.width,
        height: probe.height,
        durationMs: probe.durationMs,
        sizeBytes: result.sizeBytes,
        source: 'video-url',
        originUrl,
      });
      // 海报非致命：失败仍返回无海报的视频
      if (probe.thumbnailUrl) {
        try {
          this.assertWorld(task);
          const poster = await this.mediaService.ingestImageFromUrl(
            task.userId,
            probe.thumbnailUrl,
            'poster',
          );
          view = this.mediaService.setPoster(view.id, poster.id);
        } catch {
          // 忽略海报失败
        }
      }
      task.progress = 100;
      return view;
    } catch (err) {
      if (err instanceof Error && err.message.includes('max-filesize')) {
        throw new VideoTaskError('TOO_LARGE', '视频超出体积上限');
      }
      throw err;
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }

  /** 任务创建后世界可能被热切换：每次落库/查库前核对，不写错世界 */
  private assertWorld(task: VideoTask): void {
    if (this.worldManager.current().worldId !== task.worldId) {
      throw new VideoTaskError('WORLD_CHANGED', '世界已切换，任务终止');
    }
  }
}
