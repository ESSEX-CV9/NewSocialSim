import type { WorldDb } from '../../core/db/database.js';

/** link_cards 表原始行：按 URL 缓存 OG 元数据（失败也缓存，防反复抓取） */
export interface LinkCardRow {
  url: string;
  title: string | null;
  description: string | null;
  image_media_id: number | null;
  site_name: string | null;
  status: 'ok' | 'failed';
  fetched_at: number;
}

export const linkCardsRepo = {
  find(db: WorldDb, url: string): LinkCardRow | undefined {
    return db.prepare('SELECT * FROM link_cards WHERE url = ?').get(url) as LinkCardRow | undefined;
  },

  findMany(db: WorldDb, urls: string[]): LinkCardRow[] {
    if (urls.length === 0) return [];
    const placeholders = urls.map(() => '?').join(',');
    return db
      .prepare(`SELECT * FROM link_cards WHERE url IN (${placeholders})`)
      .all(...urls) as LinkCardRow[];
  },

  upsert(db: WorldDb, row: Omit<LinkCardRow, 'fetched_at'> & { fetchedAt: number }): void {
    db.prepare(
      `INSERT INTO link_cards (url, title, description, image_media_id, site_name, status, fetched_at)
       VALUES (@url, @title, @description, @imageMediaId, @siteName, @status, @fetchedAt)
       ON CONFLICT(url) DO UPDATE SET
         title = @title, description = @description, image_media_id = @imageMediaId,
         site_name = @siteName, status = @status, fetched_at = @fetchedAt`,
    ).run({
      url: row.url,
      title: row.title,
      description: row.description,
      imageMediaId: row.image_media_id,
      siteName: row.site_name,
      status: row.status,
      fetchedAt: row.fetchedAt,
    });
  },
};
