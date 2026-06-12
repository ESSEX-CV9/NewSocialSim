import fs from 'node:fs';
import path from 'node:path';
import type { MediaView } from '@socialsim/shared';
import { config } from '../../config.js';
import { AppError } from '../../core/errors/app-error.js';
import type { WorldManager } from '../../core/world/world-manager.js';
import { deriveEmbed, type EmbedSite } from '../link-cards/embed.js';
import type { MediaService } from '../media/media.service.js';
import { readSearchConfig, videoSettings, type VideoSettings } from '../media-search/search-config.js';
import type { ToolsService } from '../tools/tools.service.js';
import { PornhubVideoAdapter } from './adapters/pornhub.js';
import { Rule34VideoAdapter } from './adapters/rule34video.js';
import type { VideoSearchAdapter, VideoSearchResult, VideoSourceAvailability } from './adapters/types.js';
import { YouTubeVideoAdapter } from './adapters/youtube.js';
import { StreamResolver, type ResolvedStream } from './stream-resolver.js';
import { VideoTaskError, VideoTaskManager, type VideoTask, type VideoTaskView } from './video-tasks.js';
import { YtDlp, type ProbeResult, type YtDlpRequestOpts } from './ytdlp.js';

export interface VideoSourceStatus extends VideoSourceAvailability {
  id: string;
}

/** 按目标站点组装 yt-dlp 请求选项：全局代理 + 站点 Cookie（B站 412 风控需浏览器 Cookie） */
export function requestOptsFor(url: string): YtDlpRequestOpts {
  const cfg = readSearchConfig();
  const opts: YtDlpRequestOpts = { proxy: cfg.proxy?.trim() || undefined };
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'bilibili.com' || host.endsWith('.bilibili.com') || host === 'b23.tv') {
      const value = cfg.bilibili?.cookies?.trim();
      if (value) opts.cookie = { domain: '.bilibili.com', value };
    }
  } catch {
    // URL 异常由后续 probe 报错
  }
  return opts;
}

export type IngestMode = 'auto' | 'download' | 'stream';

export interface IngestResult {
  /** auto 命中嵌入卡：不建任务，调用方把 URL 留在正文走链接卡 */
  embed?: { embedUrl: string; site: EmbedSite };
  task?: VideoTaskView;
}

function assertValidUrl(url: string): void {
  try {
    new URL(url);
  } catch {
    throw new AppError(400, 'VALIDATION', '链接格式不正确');
  }
}

const PER_SOURCE_LIMIT = 20;

export class VideoSearchService {
  private readonly ytdlp: YtDlp;
  private readonly resolver: StreamResolver;
  private readonly adapters: VideoSearchAdapter[] = [
    new YouTubeVideoAdapter(),
    new PornhubVideoAdapter(),
    new Rule34VideoAdapter(),
  ];
  readonly tasks = new VideoTaskManager();

  constructor(
    private readonly worldManager: WorldManager,
    toolsService: ToolsService,
    private readonly mediaService: MediaService,
  ) {
    this.ytdlp = new YtDlp(toolsService);
    this.resolver = new StreamResolver(this.ytdlp, requestOptsFor);
    // 有任务在执行时拒绝覆盖二进制（Windows 文件锁）
    toolsService.setBusyCheck(() => this.tasks.hasRunning());
  }

  /** /stream 代理端点用：校验媒体行 → 取直链（缓存/现解析）；失败抛 410 */
  async streamTarget(mediaId: number, w: string): Promise<ResolvedStream> {
    const { originUrl } = this.mediaService.getStreamInfo(mediaId, w);
    try {
      return await this.resolver.resolve(mediaId, originUrl);
    } catch (err) {
      throw new AppError(410, 'STREAM_GONE', `源视频已失效：${err instanceof Error ? err.message : ''}`);
    }
  }

  /** 把同一流式视频的上游访问串行化（签名直链不支持同签名并发） */
  streamExclusive<T>(mediaId: number, fn: () => Promise<T>): Promise<T> {
    return this.resolver.runExclusive(mediaId, fn);
  }

  invalidateStream(mediaId: number): void {
    this.resolver.invalidate(mediaId);
  }

  /** 各视频源可用状态（唯一条件：yt-dlp 是否安装；视频源不设内容分级，见 adapters/types） */
  sources(): VideoSourceStatus[] {
    const ytdlpOk = this.ytdlp.available();
    return this.adapters.map((a) => {
      const avail = a.available({ ytdlpOk });
      return {
        id: a.name,
        ok: avail.ok,
        ...(avail.reason ? { reason: avail.reason } : {}),
      };
    });
  }

  /** 单源直查 / 缺省全可用源并行（单源失败静默吞掉） */
  async search(query: string, source?: string): Promise<VideoSearchResult[]> {
    const q = query.trim();
    if (!q) throw new AppError(400, 'VALIDATION', '搜索关键词不能为空');
    const cfg = readSearchConfig();
    const ytdlpOk = this.ytdlp.available();
    const deps = { ytdlp: this.ytdlp, cfg, proxy: cfg.proxy?.trim() || undefined };

    let chosen: VideoSearchAdapter[];
    if (source) {
      const adapter = this.adapters.find((a) => a.name === source);
      if (!adapter) throw new AppError(400, 'VALIDATION', `未知的视频源：${source}`);
      const avail = adapter.available({ ytdlpOk });
      if (!avail.ok) throw new AppError(400, 'VALIDATION', `视频源 ${source} 不可用：${avail.reason ?? ''}`);
      chosen = [adapter];
    } else {
      chosen = this.adapters.filter((a) => a.available({ ytdlpOk }).ok);
    }

    const settled = await Promise.allSettled(chosen.map((a) => a.search(q, PER_SOURCE_LIMIT, deps)));
    const results: VideoSearchResult[] = [];
    for (const s of settled) {
      if (s.status === 'fulfilled') results.push(...s.value);
      else console.error('[video-search] 单源失败：', s.reason);
    }
    return results;
  }

  /**
   * 引入外站视频。mode='auto' 时服务端按形态路由裁决：
   * 可嵌入站点默认走嵌入卡（不建任务）；siteModes 覆盖为 download/stream 则建任务；
   * 非可嵌入站点按全局 defaultMode。显式 mode 无条件按指定模式。
   */
  ingest(userId: number, url: string, mode: IngestMode): IngestResult {
    assertValidUrl(url);
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

    if (!this.ytdlp.available()) {
      throw new AppError(400, 'TOOL_MISSING', 'yt-dlp 未安装，请到设置页"视频工具"安装');
    }
    // 视频源/引入不设内容分级：平台性质本身决定可见内容，不受世界 contentRating 约束
    const { worldId, clock } = this.worldManager.current();

    const task = this.tasks.enqueue(
      userId,
      worldId,
      { url, mode: resolved, createdAt: clock.now() },
      (t) => (t.mode === 'stream' ? this.runStream(t) : this.runDownload(t)),
    );
    return { task };
  }

  /** probe（带 URL_UNSUPPORTED 包装）+ 标题落任务 */
  private async probeFor(task: VideoTask, opts: YtDlpRequestOpts): Promise<ProbeResult> {
    const probe = await this.ytdlp.probe(task.url, opts, task.abort.signal).catch((err: Error) => {
      throw new VideoTaskError('URL_UNSUPPORTED', `无法解析该链接：${err.message}`);
    });
    task.title = probe.title;
    return probe;
  }

  /** 下载模式执行流：probe → 同源去重 → 下载 → 世界核对 → 入库 → 海报（非致命） */
  private async runDownload(task: VideoTask): Promise<MediaView> {
    const settings = videoSettings(readSearchConfig());
    const opts = requestOptsFor(task.url);

    const probe = await this.probeFor(task, opts);
    const originUrl = probe.webpageUrl || task.url;

    // 同源去重：已有同 origin_url 的入库视频则复用，不重复下载字节
    this.assertWorld(task);
    const reused = this.mediaService.reuseVideoByOrigin(task.userId, originUrl);
    if (reused) {
      task.progress = 100;
      return reused;
    }
    return this.downloadAndStore(task, probe, originUrl, settings, opts);
  }

  /** 流式引用执行流：probe → 去重 → 渐进式判定（HLS 按配置回退）→ 海报（刚需）→ 建流式行 */
  private async runStream(task: VideoTask): Promise<MediaView> {
    const settings = videoSettings(readSearchConfig());
    const opts = requestOptsFor(task.url);

    const probe = await this.probeFor(task, opts);
    const originUrl = probe.webpageUrl || task.url;

    this.assertWorld(task);
    const reused = this.mediaService.reuseStreamByOrigin(task.userId, originUrl);
    if (reused) {
      if (probe.progressive) this.resolver.prime(reused.id, probe.progressive);
      task.progress = 100;
      return reused;
    }

    if (!probe.progressive) {
      if (settings.hlsFallback === 'download') {
        // 降转下载：先查下载行去重，再走下载尾段
        const reusedLib = this.mediaService.reuseVideoByOrigin(task.userId, originUrl);
        if (reusedLib) {
          task.progress = 100;
          return reusedLib;
        }
        return this.downloadAndStore(task, probe, originUrl, settings, opts);
      }
      throw new VideoTaskError('HLS_ONLY', '该源没有可直连播放的单文件格式（HLS/DASH-only），可改用下载模式');
    }
    if (!probe.thumbnailUrl) {
      throw new VideoTaskError('FAILED', '该源没有封面图，流式引用需要海报占位');
    }
    this.assertWorld(task);
    const poster = await this.mediaService
      .ingestImageFromUrl(task.userId, probe.thumbnailUrl, 'poster')
      .catch((err: Error) => {
        throw new VideoTaskError('FAILED', `海报下载失败：${err.message}`);
      });
    this.assertWorld(task);
    const view = this.mediaService.createStreamVideo(task.userId, {
      width: probe.progressive.width ?? probe.width,
      height: probe.progressive.height ?? probe.height,
      durationMs: probe.durationMs,
      originUrl,
      posterMediaId: poster.id,
    });
    this.resolver.prime(view.id, probe.progressive);
    task.progress = 100;
    return view;
  }

  /** 下载尾段（下载模式与流式 HLS 回退共用）：下载 → 限额核对 → 世界核对 → 入库 → 海报非致命 */
  private async downloadAndStore(
    task: VideoTask,
    probe: ProbeResult,
    originUrl: string,
    settings: VideoSettings,
    opts: YtDlpRequestOpts,
  ): Promise<MediaView> {
    const signal = task.abort.signal;
    if (probe.filesizeApprox !== null && probe.filesizeApprox > settings.maxBytes * 1.2) {
      throw new VideoTaskError(
        'TOO_LARGE',
        `视频约 ${Math.round(probe.filesizeApprox / 1024 / 1024)}MB，超出 ${Math.round(settings.maxBytes / 1024 / 1024)}MB 上限`,
      );
    }
    task.status = 'downloading';
    const outDir = path.join(config.dataDir, 'tmp', 'video', task.id);
    try {
      const result = await this.ytdlp.download(
        originUrl,
        { maxHeight: settings.maxHeight, maxBytes: settings.maxBytes, outDir, ...opts },
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
