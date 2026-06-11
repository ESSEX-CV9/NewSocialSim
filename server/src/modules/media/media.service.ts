import fs from 'node:fs';
import path from 'node:path';
import type { MediaView } from '@socialsim/shared';
import { imageSize } from 'image-size';
import { config } from '../../config.js';
import { NotFoundError, ValidationError } from '../../core/errors/app-error.js';
import type { WorldManager } from '../../core/world/world-manager.js';
import { mediaRepo, type MediaRow } from './media.repo.js';

/** 图片 mime 白名单 → 存盘扩展名 */
const IMAGE_MIMES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** 一条帖子最多挂的媒体数（X 规则） */
const MAX_PER_POST = 4;

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

  /** 文件流（公开端点用）；w 与活动世界不一致按不存在处理 */
  getFileStream(id: number, w: string): { stream: fs.ReadStream; mime: string; size: number } {
    const { worldId, db } = this.worldManager.current();
    if (w !== worldId) throw new NotFoundError(`媒体 #${id} 不存在`);
    const row = mediaRepo.findById(db, id);
    if (!row || !row.file_name) throw new NotFoundError(`媒体 #${id} 不存在`);
    const filePath = path.join(this.mediaDir(), row.file_name);
    if (!fs.existsSync(filePath)) throw new NotFoundError(`媒体 #${id} 文件缺失`);
    return {
      stream: fs.createReadStream(filePath),
      mime: row.mime,
      size: row.size_bytes,
    };
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
   * 校验一组媒体可挂到新帖：≤4、全部存在且本人所有、未被其他帖占用。
   * A 期仅图片。规则：一条媒体只能挂一个帖子；头像/Banner 不占用名额。
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
      if (row.type !== 'image') throw new ValidationError('暂只支持图片媒体');
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
