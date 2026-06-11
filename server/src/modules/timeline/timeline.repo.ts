import type { WorldDb } from '../../core/db/database.js';

/** 时间线条目骨架：先取"哪些帖子、何时、因何出现"，视图由 posts 模块补全 */
export interface TimelineEntryRow {
  post_id: number;
  activity_at: number;
  item_type: 'post' | 'repost';
  actor_id: number | null;
  actor_handle: string | null;
  actor_display_name: string | null;
  actor_is_bot: number | null;
}

const CURSOR_CLAUSE = 'WHERE (activity_at < @ts OR (activity_at = @ts AND post_id < @cid))';

export const timelineRepo = {
  /**
   * 关注流：自己 + 关注者的原创帖（非回复），加上他们的转发。
   * 转发以转发时间排序，并带上转发者信息。
   */
  homeEntries(
    db: WorldDb,
    userId: number,
    before: { ts: number; id: number } | null,
    limit: number,
  ): TimelineEntryRow[] {
    return db
      .prepare(
        `SELECT * FROM (
           SELECT p.id          AS post_id,
                  p.created_at  AS activity_at,
                  'post'        AS item_type,
                  NULL          AS actor_id,
                  NULL          AS actor_handle,
                  NULL          AS actor_display_name,
                  NULL          AS actor_is_bot
           FROM posts p
           WHERE p.deleted = 0 AND p.reply_to_id IS NULL
             AND p.author_id IN (
               SELECT followee_id FROM follows WHERE follower_id = @userId
               UNION SELECT @userId
             )
           UNION ALL
           SELECT r.post_id,
                  r.created_at,
                  'repost',
                  u.id, u.handle, u.display_name, u.is_bot
           FROM reposts r
           JOIN users u ON u.id = r.user_id
           JOIN posts p ON p.id = r.post_id
           WHERE p.deleted = 0
             AND r.user_id IN (
               SELECT followee_id FROM follows WHERE follower_id = @userId
               UNION SELECT @userId
             )
         )
         ${before ? CURSOR_CLAUSE : ''}
         ORDER BY activity_at DESC, post_id DESC
         LIMIT @limit`,
      )
      .all({ userId, limit, ...(before ? { ts: before.ts, cid: before.id } : {}) }) as TimelineEntryRow[];
  },

  /** 全站流：所有原创帖（非回复），不含转发条目 */
  globalEntries(
    db: WorldDb,
    before: { ts: number; id: number } | null,
    limit: number,
  ): TimelineEntryRow[] {
    return db
      .prepare(
        `SELECT * FROM (
           SELECT p.id         AS post_id,
                  p.created_at AS activity_at,
                  'post'       AS item_type,
                  NULL AS actor_id, NULL AS actor_handle,
                  NULL AS actor_display_name, NULL AS actor_is_bot
           FROM posts p
           WHERE p.deleted = 0 AND p.reply_to_id IS NULL
         )
         ${before ? CURSOR_CLAUSE : ''}
         ORDER BY activity_at DESC, post_id DESC
         LIMIT @limit`,
      )
      .all({ limit, ...(before ? { ts: before.ts, cid: before.id } : {}) }) as TimelineEntryRow[];
  },
};
