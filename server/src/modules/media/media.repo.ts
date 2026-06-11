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
    },
  ): number {
    const result = db
      .prepare(
        `INSERT INTO media (owner_id, type, file_name, mime, width, height, size_bytes, source, origin_url, created_at)
         VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?)`,
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
      );
    return Number(result.lastInsertRowid);
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

  /** 已被任何帖子占用的媒体 id 集合 */
  attachedSet(db: WorldDb, mediaIds: number[]): Set<number> {
    if (mediaIds.length === 0) return new Set();
    const placeholders = mediaIds.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT DISTINCT media_id FROM post_media WHERE media_id IN (${placeholders})`)
      .all(...mediaIds) as { media_id: number }[];
    return new Set(rows.map((r) => r.media_id));
  },

  attachToPost(db: WorldDb, postId: number, mediaIds: number[]): void {
    const stmt = db.prepare('INSERT INTO post_media (post_id, media_id, position) VALUES (?, ?, ?)');
    mediaIds.forEach((mediaId, i) => stmt.run(postId, mediaId, i));
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
