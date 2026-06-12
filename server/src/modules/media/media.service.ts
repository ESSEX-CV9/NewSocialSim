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
/** 视频上限缺省值；实际限额由组装层注入的 videoLimits 提供（media-search.json 的 video 段可调） */
const DEFAULT_MAX_VIDEO_BYTES = 150 * 1024 * 1024;
/** 一条帖子最多挂的媒体数（防呆硬顶，图/视频共享配额且可混排；帖子卡只显示前 4 个） */
const MAX_PER_POST = 20;
/** 一条私信消息最多挂的媒体数（对照 X） */
const MAX_PER_MESSAGE = 4;

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

/** 经代理拉外站图可能较慢，放宽到 30 秒 */
const URL_FETCH_TIMEOUT_MS = 30_000;

/** 媒体文件公开 URL 的纯函数版（供各模块组装 UserSummary 等使用） */
export function mediaFileUrl(mediaId: number | null, worldId: string): string | null {
  if (mediaId === null) return null;
  return `/api/media/${mediaId}/file?w=${encodeURIComponent(worldId)}`;
}

export class MediaService {
  constructor(
    private readonly worldManager: WorldManager,
    /** 视频体积上限（字节），组装层从实例配置现读注入；默认 150MB */
    private readonly maxVideoBytes: () => number = () => DEFAULT_MAX_VIDEO_BYTES,
  ) {}

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

  /** 流式引用视频的播放 URL（服务端现解直链做 Range 透传代理） */
  private streamUrl(mediaId: number): string {
    const { worldId } = this.worldManager.current();
    return `/api/media/${mediaId}/stream?w=${encodeURIComponent(worldId)}`;
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
      const maxBytes = this.maxVideoBytes();
      if (source.truncated || size > maxBytes) {
        throw new ValidationError(`视频最大 ${Math.round(maxBytes / 1024 / 1024)}MB`);
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

  /**
   * 从已下载的临时文件创建视频媒体（外站视频引入用）：插行 → rename 入媒体目录 → 失败回滚。
   * 调用方负责保证 filePath 与世界目录同卷（data/ 下），rename 才是原子移动。
   */
  createVideoFromFile(
    ownerId: number,
    filePath: string,
    meta: {
      width: number | null;
      height: number | null;
      durationMs: number | null;
      sizeBytes: number;
      source: string;
      originUrl: string;
    },
  ): MediaView {
    const { db, clock } = this.worldManager.current();
    const id = db.transaction(() => {
      const mediaId = mediaRepo.insert(db, {
        ownerId,
        type: 'video',
        mime: 'video/mp4',
        width: meta.width,
        height: meta.height,
        sizeBytes: meta.sizeBytes,
        source: meta.source,
        originUrl: meta.originUrl,
        createdAt: clock.now(),
        durationMs: meta.durationMs,
      });
      mediaRepo.updateFileName(db, mediaId, `${mediaId}.mp4`);
      return mediaId;
    })();
    try {
      fs.renameSync(filePath, path.join(this.mediaDir(), `${id}.mp4`));
    } catch (err) {
      mediaRepo.delete(db, id);
      throw err;
    }
    return this.toView(mediaRepo.findById(db, id)!);
  }

  /**
   * 创建流式引用视频行：不存文件（file_name 留空占位，/file 端点天然 404），
   * 只存 origin_url 与元数据；海报为刚需（流式无本地帧，失败应由调用方拦截）。
   */
  createStreamVideo(
    ownerId: number,
    meta: {
      width: number | null;
      height: number | null;
      durationMs: number | null;
      originUrl: string;
      posterMediaId: number;
    },
  ): MediaView {
    const { db, clock } = this.worldManager.current();
    const id = mediaRepo.insert(db, {
      ownerId,
      type: 'video',
      mime: 'video/mp4',
      width: meta.width,
      height: meta.height,
      sizeBytes: 0,
      source: 'video-stream',
      originUrl: meta.originUrl,
      createdAt: clock.now(),
      storage: 'stream',
      durationMs: meta.durationMs,
      posterMediaId: meta.posterMediaId,
    });
    return this.toView(mediaRepo.findById(db, id)!);
  }

  /** 同源去重（流式行）：同主未挂接直接复用；否则复制元数据与海报引用为新行（无字节成本） */
  reuseStreamByOrigin(ownerId: number, originUrl: string): MediaView | null {
    const { db, clock } = this.worldManager.current();
    const rows = mediaRepo.findVideosByOrigin(db, originUrl, 'stream');
    if (rows.length === 0) return null;
    const attached = mediaRepo.attachedSet(db, rows.map((r) => r.id));
    const own = rows.find((r) => r.owner_id === ownerId && !attached.has(r.id));
    if (own) return this.toView(own);
    const src = rows[0]!;
    if (src.poster_media_id === null) return null;
    const id = mediaRepo.insert(db, {
      ownerId,
      type: 'video',
      mime: src.mime,
      width: src.width,
      height: src.height,
      sizeBytes: 0,
      source: src.source,
      originUrl,
      createdAt: clock.now(),
      storage: 'stream',
      durationMs: src.duration_ms,
      posterMediaId: src.poster_media_id,
    });
    return this.toView(mediaRepo.findById(db, id)!);
  }

  /** 流式行的源信息（/stream 代理端点用）；非流式行/世界不符一律 404 */
  getStreamInfo(id: number, w: string): { originUrl: string } {
    const { worldId, db } = this.worldManager.current();
    if (w !== worldId) throw new NotFoundError(`媒体 #${id} 不存在`);
    const row = mediaRepo.findById(db, id);
    if (!row || row.type !== 'video' || row.storage !== 'stream' || !row.origin_url) {
      throw new NotFoundError(`媒体 #${id} 不存在`);
    }
    return { originUrl: row.origin_url };
  }

  /** 给视频媒体补挂海报图（海报为独立 image media 行，不挂帖不占名额） */
  setPoster(mediaId: number, posterMediaId: number): MediaView {
    const { db } = this.worldManager.current();
    mediaRepo.setPoster(db, mediaId, posterMediaId);
    return this.toView(mediaRepo.findById(db, mediaId)!);
  }

  /**
   * 同源去重：同 origin_url 的已入库（library）视频按需复用。
   * 本人未挂接的行直接复用；否则以最新有文件的行为源，硬链接复制字节为本人新行
   * （NTFS 同卷零拷贝；链接失败回退复制）。无可复用返回 null。
   */
  reuseVideoByOrigin(ownerId: number, originUrl: string): MediaView | null {
    const { db, clock } = this.worldManager.current();
    const rows = mediaRepo.findVideosByOrigin(db, originUrl, 'library');
    const withFile = rows.filter((r) => r.file_name);
    if (withFile.length === 0) return null;
    const attached = mediaRepo.attachedSet(db, withFile.map((r) => r.id));
    const own = withFile.find((r) => r.owner_id === ownerId && !attached.has(r.id));
    if (own) return this.toView(own);

    const dir = this.mediaDir();
    const src = withFile.find((r) => fs.existsSync(path.join(dir, r.file_name)));
    if (!src) return null;
    const ext = path.extname(src.file_name).slice(1) || 'mp4';
    const id = db.transaction(() => {
      const mediaId = mediaRepo.insert(db, {
        ownerId,
        type: 'video',
        mime: src.mime,
        width: src.width,
        height: src.height,
        sizeBytes: src.size_bytes,
        source: src.source,
        originUrl,
        createdAt: clock.now(),
        durationMs: src.duration_ms,
        // 海报行不挂帖、文件端点公开，跨用户引用同一张海报无害
        posterMediaId: src.poster_media_id,
      });
      mediaRepo.updateFileName(db, mediaId, `${mediaId}.${ext}`);
      return mediaId;
    })();
    const srcPath = path.join(dir, src.file_name);
    const destPath = path.join(dir, `${id}.${ext}`);
    try {
      try {
        fs.linkSync(srcPath, destPath);
      } catch {
        fs.copyFileSync(srcPath, destPath);
      }
    } catch (err) {
      mediaRepo.delete(db, id);
      throw err;
    }
    return this.toView(mediaRepo.findById(db, id)!);
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
   * 校验一组媒体可挂到新帖：≤20 个媒体（图/视频可混排）、全部存在且本人所有、
   * 未被占用。规则：一条媒体只能挂一处（帖子或私信消息）；头像/Banner 不占用名额。
   */
  validateAttachable(ownerId: number, mediaIds: number[]): void {
    this.validateUsable(ownerId, mediaIds, MAX_PER_POST, `一条帖子最多 ${MAX_PER_POST} 个媒体`);
  }

  /** 校验一组媒体可挂到新私信消息（≤4 个，规则同上） */
  validateAttachableToMessage(ownerId: number, mediaIds: number[]): void {
    this.validateUsable(
      ownerId,
      mediaIds,
      MAX_PER_MESSAGE,
      `一条消息最多 ${MAX_PER_MESSAGE} 个媒体`,
    );
  }

  private validateUsable(
    ownerId: number,
    mediaIds: number[],
    maxCount: number,
    overflowMessage: string,
  ): void {
    if (mediaIds.length === 0) return;
    if (mediaIds.length > maxCount) throw new ValidationError(overflowMessage);
    const { db } = this.worldManager.current();
    const rows = mediaRepo.findByIds(db, mediaIds);
    if (rows.length !== mediaIds.length) throw new ValidationError('包含不存在的媒体');
    for (const row of rows) {
      if (row.owner_id !== ownerId) throw new ValidationError('只能使用自己上传的媒体');
    }
    const attached = mediaRepo.attachedSet(db, mediaIds);
    if (attached.size > 0) throw new ValidationError('媒体已被使用');
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

  /** 事务内挂接到私信消息（messages.service.sendMessage 调用，校验须已通过） */
  attachToMessage(messageId: number, mediaIds: number[]): void {
    const { db } = this.worldManager.current();
    mediaRepo.attachToMessage(db, messageId, mediaIds);
  }

  /** 批量取多条私信消息的媒体视图 */
  viewsForMessages(messageIds: number[]): Map<number, MediaView[]> {
    const { db } = this.worldManager.current();
    const rows = mediaRepo.listForMessages(db, messageIds);
    const map = new Map<number, MediaView[]>();
    for (const row of rows) {
      const list = map.get(row.message_id) ?? [];
      list.push(this.toView(row));
      map.set(row.message_id, list);
    }
    return map;
  }

  private toView(row: MediaRow): MediaView {
    const view: MediaView = {
      id: row.id,
      type: row.type,
      url: this.fileUrl(row.id),
      width: row.width,
      height: row.height,
    };
    if (row.type === 'video') {
      const { worldId } = this.worldManager.current();
      view.durationMs = row.duration_ms;
      view.posterUrl = mediaFileUrl(row.poster_media_id, worldId);
      view.storage = row.storage;
      if (row.storage === 'stream') view.url = this.streamUrl(row.id);
    }
    return view;
  }
}
