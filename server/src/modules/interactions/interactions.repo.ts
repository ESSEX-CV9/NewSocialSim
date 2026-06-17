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

  /** 某账号的互动事件（赞/转/关注），按互动时间倒序，UNION 三表；游标 [created_at, kind, ref]。 */
  listUserActivity(
    db: WorldDb,
    userId: number,
    before: { ts: number; kind: string; ref: number } | null,
    limit: number,
    range?: { from?: number | undefined; to?: number | undefined },
  ): { kind: 'like' | 'repost' | 'follow'; ref: number; created_at: number }[] {
    // 排序键：created_at DESC, kind ASC, ref DESC。游标谓词按各分支字面 kind 注入。
    const pred = (kind: string, refCol: string) =>
      before
        ? `AND (created_at < @cts OR (created_at = @cts AND '${kind}' > @ck) OR (created_at = @cts AND '${kind}' = @ck AND ${refCol} < @cref))`
        : '';
    // 时间区间（作用于各表 created_at）；供时间轴按可见窗口取数，避免"只取最新 N 条"丢历史。
    const rangeClause =
      (range?.from != null ? 'AND created_at >= @from ' : '') + (range?.to != null ? 'AND created_at <= @to' : '');
    const arm = (kind: string, refCol: string) => `${pred(kind, refCol)} ${rangeClause}`;
    const sql = `
      SELECT kind, ref, created_at FROM (
        SELECT 'like'   AS kind, post_id     AS ref, created_at FROM likes   WHERE user_id     = @uid ${arm('like', 'post_id')}
        UNION ALL
        SELECT 'repost' AS kind, post_id     AS ref, created_at FROM reposts WHERE user_id     = @uid ${arm('repost', 'post_id')}
        UNION ALL
        SELECT 'follow' AS kind, followee_id AS ref, created_at FROM follows WHERE follower_id = @uid ${arm('follow', 'followee_id')}
      )
      ORDER BY created_at DESC, kind ASC, ref DESC
      LIMIT @lim`;
    const params = {
      uid: userId,
      lim: limit,
      ...(before ? { cts: before.ts, ck: before.kind, cref: before.ref } : {}),
      ...(range?.from != null ? { from: range.from } : {}),
      ...(range?.to != null ? { to: range.to } : {}),
    };
    return db.prepare(sql).all(params) as { kind: 'like' | 'repost' | 'follow'; ref: number; created_at: number }[];
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
