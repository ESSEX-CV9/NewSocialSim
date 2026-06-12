import type { WorldDb } from '../../core/db/database.js';
import type { PostRow } from '../posts/posts.repo.js';

type InteractionTable = 'likes' | 'reposts' | 'bookmarks' | 'hidden_posts';

/** 点赞/转发/书签/隐藏帖共用同一套"用户-帖子"二元关系操作 */
export const interactionsRepo = {
  /** 幂等插入；返回是否真的新增了 */
  insert(
    db: WorldDb,
    table: InteractionTable,
    userId: number,
    postId: number,
    createdAt: number,
  ): boolean {
    const result = db
      .prepare(
        `INSERT OR IGNORE INTO ${table} (user_id, post_id, created_at) VALUES (?, ?, ?)`,
      )
      .run(userId, postId, createdAt);
    return result.changes > 0;
  },

  /** 幂等删除；返回是否真的删除了 */
  remove(db: WorldDb, table: InteractionTable, userId: number, postId: number): boolean {
    const result = db
      .prepare(`DELETE FROM ${table} WHERE user_id = ? AND post_id = ?`)
      .run(userId, postId);
    return result.changes > 0;
  },

  /** 某用户收藏的帖子，按收藏时间倒序；marked_at 供游标使用 */
  listBookmarkedBy(
    db: WorldDb,
    userId: number,
    before: { ts: number; id: number } | null,
    limit: number,
  ): (PostRow & { marked_at: number })[] {
    const cursorClause = before
      ? 'AND (b.created_at < @ts OR (b.created_at = @ts AND p.id < @cid))'
      : '';
    return db
      .prepare(
        `SELECT p.*,
                u.handle          AS author_handle,
                u.display_name    AS author_display_name,
                u.is_bot          AS author_is_bot,
                u.avatar_media_id AS author_avatar_media_id,
                b.created_at      AS marked_at
         FROM bookmarks b
         JOIN posts p ON p.id = b.post_id
         JOIN users u ON u.id = p.author_id
         WHERE b.user_id = @userId AND p.deleted = 0 ${cursorClause}
         ORDER BY b.created_at DESC, p.id DESC
         LIMIT @limit`,
      )
      .all({ userId, limit, ...(before ? { ts: before.ts, cid: before.id } : {}) }) as (PostRow & {
      marked_at: number;
    })[];
  },
};
