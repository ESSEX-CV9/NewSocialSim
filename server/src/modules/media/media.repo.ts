import type { WorldDb } from '../../core/db/database.js';

/** media 表原始行 */
export interface MediaRow {
  id: number;
  owner_id: number;
  type: 'image' | 'video';
  file_name: string;
  mime: string;
  width: number | null;
  height: number | null;
  size_bytes: number;
  source: string;
  origin_url: string | null;
  created_at: number;
  /** 'library' 文件入库 / 'stream' 流式引用（仅存 origin_url 与元数据） */
  storage: 'library' | 'stream';
  duration_ms: number | null;
  /** 视频海报图（独立 image media 行，不挂帖） */
  poster_media_id: number | null;
}

export const mediaRepo = {
  /** 两步法第一步：先占位拿 id（file_name 随后用 id 回填） */
  insert(
    db: WorldDb,
    input: {
      ownerId: number;
      type: 'image' | 'video';
      mime: string;
      width: number | null;
      height: number | null;
      sizeBytes: number;
      source: string;
      originUrl: string | null;
      createdAt: number;
      storage?: 'library' | 'stream';
      durationMs?: number | null;
      posterMediaId?: number | null;
    },
  ): number {
    const result = db
      .prepare(
        `INSERT INTO media (owner_id, type, file_name, mime, width, height, size_bytes, source, origin_url, created_at, storage, duration_ms, poster_media_id)
         VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.ownerId,
        input.type,
        input.mime,
        input.width,
        input.height,
        input.sizeBytes,
        input.source,
        input.originUrl,
        input.createdAt,
        input.storage ?? 'library',
        input.durationMs ?? null,
        input.posterMediaId ?? null,
      );
    return Number(result.lastInsertRowid);
  },

  /** 同源去重用：同 origin_url 的视频行（新→旧，最多 10 条） */
  findVideosByOrigin(db: WorldDb, originUrl: string, storage: 'library' | 'stream'): MediaRow[] {
    return db
      .prepare(
        `SELECT * FROM media WHERE origin_url = ? AND storage = ? AND type = 'video'
         ORDER BY id DESC LIMIT 10`,
      )
      .all(originUrl, storage) as MediaRow[];
  },

  setPoster(db: WorldDb, id: number, posterMediaId: number): void {
    db.prepare('UPDATE media SET poster_media_id = ? WHERE id = ?').run(posterMediaId, id);
  },

  updateFileName(db: WorldDb, id: number, fileName: string): void {
    db.prepare('UPDATE media SET file_name = ? WHERE id = ?').run(fileName, id);
  },

  /** 写盘失败时的回滚 */
  delete(db: WorldDb, id: number): void {
    db.prepare('DELETE FROM media WHERE id = ?').run(id);
  },

  findById(db: WorldDb, id: number): MediaRow | undefined {
    return db.prepare('SELECT * FROM media WHERE id = ?').get(id) as MediaRow | undefined;
  },

  findByIds(db: WorldDb, ids: number[]): MediaRow[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return db.prepare(`SELECT * FROM media WHERE id IN (${placeholders})`).all(...ids) as MediaRow[];
  },

  /** 已被任何帖子或私信消息占用的媒体 id 集合（一条媒体只能挂一处） */
  attachedSet(db: WorldDb, mediaIds: number[]): Set<number> {
    if (mediaIds.length === 0) return new Set();
    const placeholders = mediaIds.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT DISTINCT media_id FROM post_media WHERE media_id IN (${placeholders})
         UNION
         SELECT DISTINCT media_id FROM message_media WHERE media_id IN (${placeholders})`,
      )
      .all(...mediaIds, ...mediaIds) as { media_id: number }[];
    return new Set(rows.map((r) => r.media_id));
  },

  attachToPost(db: WorldDb, postId: number, mediaIds: number[]): void {
    const stmt = db.prepare('INSERT INTO post_media (post_id, media_id, position) VALUES (?, ?, ?)');
    mediaIds.forEach((mediaId, i) => stmt.run(postId, mediaId, i));
  },

  attachToMessage(db: WorldDb, messageId: number, mediaIds: number[]): void {
    const stmt = db.prepare(
      'INSERT INTO message_media (message_id, media_id, position) VALUES (?, ?, ?)',
    );
    mediaIds.forEach((mediaId, i) => stmt.run(messageId, mediaId, i));
  },

  /** 批量取多条私信消息的媒体（按 position 排序） */
  listForMessages(
    db: WorldDb,
    messageIds: number[],
  ): (MediaRow & { message_id: number; position: number })[] {
    if (messageIds.length === 0) return [];
    const placeholders = messageIds.map(() => '?').join(',');
    return db
      .prepare(
        `SELECT m.*, mm.message_id, mm.position
         FROM message_media mm
         JOIN media m ON m.id = mm.media_id
         WHERE mm.message_id IN (${placeholders})
         ORDER BY mm.message_id, mm.position`,
      )
      .all(...messageIds) as (MediaRow & { message_id: number; position: number })[];
  },

  /** 批量取多个帖子的媒体（按 position 排序），供 buildViews 用 */
  listForPosts(db: WorldDb, postIds: number[]): (MediaRow & { post_id: number; position: number })[] {
    if (postIds.length === 0) return [];
    const placeholders = postIds.map(() => '?').join(',');
    return db
      .prepare(
        `SELECT m.*, pm.post_id, pm.position
         FROM post_media pm
         JOIN media m ON m.id = pm.media_id
         WHERE pm.post_id IN (${placeholders})
         ORDER BY pm.post_id, pm.position`,
      )
      .all(...postIds) as (MediaRow & { post_id: number; position: number })[];
  },
};
