import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { MediaView } from '@socialsim/shared';
import { imageSize } from 'image-size';
import { config } from '../../config.js';
import { NotFoundError, ValidationError } from '../../core/errors/app-error.js';
import { fetchWithLimit } from '../../core/safe-fetch.js';
import type { WorldManager } from '../../core/world/world-manager.js';
import { mediaRepo, type MediaRow } from './media.repo.js';

/** 图片 mime 白名单 → 存盘扩展名 */
const IMAGE_MIMES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
/** 视频 mime 白名单 → 存盘扩展名 */
const VIDEO_MIMES: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
/** 一条帖子最多挂的媒体数（X 规则） */
const MAX_PER_POST = 4;

export function isImageMime(mime: string): boolean {
  return mime in IMAGE_MIMES;
}

export function isVideoMime(mime: string): boolean {
  return mime in VIDEO_MIMES;
}

/** 视频临时落盘文件名计数器（进程内自增，避免并发上传互踩） */
let pendingCounter = 0;

/** image-size 探测出的格式 → mime（content-type 不可信时的嗅探兜底） */
const SNIFF_TYPE_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** 需要特定 Referer 才放行图片的站点（防盗链；D 期搜图复用） */
const REFERER_BY_HOST: Record<string, string> = {
  'i.pximg.net': 'https://www.pixiv.net/',
  's.pximg.net': 'https://www.pixiv.net/',
};

const URL_FETCH_TIMEOUT_MS = 10_000;

/** 媒体文件公开 URL 的纯函数版（供各模块组装 UserSummary 等使用） */
export function mediaFileUrl(mediaId: number | null, worldId: string): string | null {
  if (mediaId === null) return null;
  return `/api/media/${mediaId}/file?w=${encodeURIComponent(worldId)}`;
}

export class MediaService {
  constructor(private readonly worldManager: WorldManager) {}

  /** 当前世界的媒体目录；每次现算，热切换安全 */
  private mediaDir(): string {
    const { worldId } = this.worldManager.current();
    const dir = path.join(config.worldsDir, worldId, 'media');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** 媒体文件公开 URL；?w= 区分不同世界的同号媒体，配合 immutable 缓存 */
  fileUrl(mediaId: number): string {
    const { worldId } = this.worldManager.current();
    return mediaFileUrl(mediaId, worldId)!;
  }

  /** 从内存缓冲创建图片媒体（上传与 C/D 期的外链下载共用此入口） */
  createFromBuffer(
    ownerId: number,
    buf: Buffer,
    mime: string,
    source: string,
    originUrl: string | null = null,
  ): MediaView {
    const ext = IMAGE_MIMES[mime];
    if (!ext) throw new ValidationError(`不支持的图片类型：${mime}`);
    if (buf.length === 0) throw new ValidationError('文件为空');
    if (buf.length > MAX_IMAGE_BYTES) {
      throw new ValidationError(`图片最大 ${MAX_IMAGE_BYTES / 1024 / 1024}MB`);
    }

    let width: number;
    let height: number;
    try {
      const dim = imageSize(buf);
      if (!dim.width || !dim.height) throw new Error('no dimensions');
      width = dim.width;
      height = dim.height;
    } catch {
      throw new ValidationError('无法解析图片内容');
    }

    const { db, clock } = this.worldManager.current();
    const id = db.transaction(() => {
      const mediaId = mediaRepo.insert(db, {
        ownerId,
        type: 'image',
        mime,
        width,
        height,
        sizeBytes: buf.length,
        source,
        originUrl,
        createdAt: clock.now(),
      });
      mediaRepo.updateFileName(db, mediaId, `${mediaId}.${ext}`);
      return mediaId;
    })();

    try {
      fs.writeFileSync(path.join(this.mediaDir(), `${id}.${ext}`), buf);
    } catch (err) {
      mediaRepo.delete(db, id);
      throw err;
    }

    const row = mediaRepo.findById(db, id)!;
    return this.toView(row);
  }

  /** 外链图片下载入库（URL 引入 / 搜图选图 / 链接卡片缩略图共用此入口） */
  async ingestImageFromUrl(ownerId: number, url: string, source: string): Promise<MediaView> {
    const host = new URL(url).hostname.toLowerCase();
    const referer = REFERER_BY_HOST[host];
    const { buf, contentType } = await fetchWithLimit(url, {
      timeoutMs: URL_FETCH_TIMEOUT_MS,
      maxBytes: MAX_IMAGE_BYTES,
      ...(referer ? { headers: { Referer: referer } } : {}),
    });
    // content-type 不可信：白名单外尝试用 image-size 嗅探真实格式
    let mime = contentType;
    if (!(mime in IMAGE_MIMES)) {
      try {
        const sniffed = imageSize(buf).type;
        mime = (sniffed && SNIFF_TYPE_TO_MIME[sniffed]) || '';
      } catch {
        mime = '';
      }
      if (!mime) throw new ValidationError('链接内容不是支持的图片格式');
    }
    return this.createFromBuffer(ownerId, buf, mime, source, url);
  }

  /** 视频从流式上传创建：先落临时文件（不进内存），入库后改名为 <id>.<ext> */
  async createVideoFromStream(
    ownerId: number,
    source: Readable & { truncated?: boolean },
    mime: string,
  ): Promise<MediaView> {
    const ext = VIDEO_MIMES[mime];
    if (!ext) throw new ValidationError(`不支持的视频类型：${mime}`);

    const dir = this.mediaDir();
    const tmpPath = path.join(dir, `pending-${process.pid}-${++pendingCounter}.${ext}`);
    let size = 0;
    try {
      source.on('data', (chunk: Buffer) => {
        size += chunk.length;
      });
      await pipeline(source, fs.createWriteStream(tmpPath));
      // multipart 的 fileSize 上限触发时流被截断而不报错，必须显式检查
      if (source.truncated || size > MAX_VIDEO_BYTES) {
        throw new ValidationError(`视频最大 ${MAX_VIDEO_BYTES / 1024 / 1024}MB`);
      }
      if (size === 0) throw new ValidationError('文件为空');

      const { db, clock } = this.worldManager.current();
      const id = db.transaction(() => {
        const mediaId = mediaRepo.insert(db, {
          ownerId,
          type: 'video',
          mime,
          width: null,
          height: null,
          sizeBytes: size,
          source: 'upload',
          originUrl: null,
          createdAt: clock.now(),
        });
        mediaRepo.updateFileName(db, mediaId, `${mediaId}.${ext}`);
        return mediaId;
      })();
      try {
        fs.renameSync(tmpPath, path.join(dir, `${id}.${ext}`));
      } catch (err) {
        mediaRepo.delete(db, id);
        throw err;
      }
      const row = mediaRepo.findById(db, id)!;
      return this.toView(row);
    } catch (err) {
      fs.rmSync(tmpPath, { force: true });
      throw err;
    }
  }

  /** 文件元信息（公开端点用，Range 由 controller 处理）；w 与活动世界不一致按不存在处理 */
  getFileInfo(id: number, w: string): { filePath: string; mime: string; size: number } {
    const { worldId, db } = this.worldManager.current();
    if (w !== worldId) throw new NotFoundError(`媒体 #${id} 不存在`);
    const row = mediaRepo.findById(db, id);
    if (!row || !row.file_name) throw new NotFoundError(`媒体 #${id} 不存在`);
    const filePath = path.join(this.mediaDir(), row.file_name);
    if (!fs.existsSync(filePath)) throw new NotFoundError(`媒体 #${id} 文件缺失`);
    return { filePath, mime: row.mime, size: row.size_bytes };
  }

  /** 批量取多个帖子的媒体视图（posts.service.buildViews 用） */
  viewsForPosts(postIds: number[]): Map<number, MediaView[]> {
    const { db } = this.worldManager.current();
    const rows = mediaRepo.listForPosts(db, postIds);
    const map = new Map<number, MediaView[]>();
    for (const row of rows) {
      const list = map.get(row.post_id) ?? [];
      list.push(this.toView(row));
      map.set(row.post_id, list);
    }
    return map;
  }

  /**
   * 校验一组媒体可挂到新帖：≤4 张图或恰 1 个视频（不混排）、全部存在且本人所有、
   * 未被其他帖占用。规则：一条媒体只能挂一个帖子；头像/Banner 不占用名额。
   */
  validateAttachable(ownerId: number, mediaIds: number[]): void {
    if (mediaIds.length === 0) return;
    if (mediaIds.length > MAX_PER_POST) {
      throw new ValidationError(`一条帖子最多 ${MAX_PER_POST} 个媒体`);
    }
    const { db } = this.worldManager.current();
    const rows = mediaRepo.findByIds(db, mediaIds);
    if (rows.length !== mediaIds.length) throw new ValidationError('包含不存在的媒体');
    for (const row of rows) {
      if (row.owner_id !== ownerId) throw new ValidationError('只能使用自己上传的媒体');
    }
    if (rows.some((r) => r.type === 'video') && rows.length > 1) {
      throw new ValidationError('视频只能单独发布，不能与其他媒体混排');
    }
    const attached = mediaRepo.attachedSet(db, mediaIds);
    if (attached.size > 0) throw new ValidationError('媒体已被其他帖子使用');
  }

  /** 校验头像/Banner 用图：存在、本人所有、是图片 */
  validateOwnedImage(ownerId: number, mediaId: number): void {
    const { db } = this.worldManager.current();
    const row = mediaRepo.findById(db, mediaId);
    if (!row) throw new ValidationError(`媒体 #${mediaId} 不存在`);
    if (row.owner_id !== ownerId) throw new ValidationError('只能使用自己上传的媒体');
    if (row.type !== 'image') throw new ValidationError('头像与横幅只能使用图片');
  }

  /** 事务内挂接（posts.service.create 调用，校验须已通过） */
  attachToPost(postId: number, mediaIds: number[]): void {
    const { db } = this.worldManager.current();
    mediaRepo.attachToPost(db, postId, mediaIds);
  }

  private toView(row: MediaRow): MediaView {
    return {
      id: row.id,
      type: row.type,
      url: this.fileUrl(row.id),
      width: row.width,
      height: row.height,
    };
  }
}
