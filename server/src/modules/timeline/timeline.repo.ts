import type { WorldDb } from '../../core/db/database.js';
import { NOT_BLOCKED_AUTHOR, NOT_HIDDEN } from '../posts/posts.repo.js';

/** 转发条目：转发者被观察者屏蔽时也不出现 */
const NOT_BLOCKED_REPOSTER =
  'AND r.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = @viewerId)';

/** 时间线条目骨架：先取"哪些帖子、何时、因何出现"，视图由 posts 模块补全 */
export interface TimelineEntryRow {
  post_id: number;
  activity_at: number;
  item_type: 'post' | 'repost';
  actor_id: number | null;
  actor_handle: string | null;
  actor_display_name: string | null;
  actor_is_bot: number | null;
  actor_avatar_media_id: number | null;
}

const CURSOR_CLAUSE = 'WHERE (activity_at < @ts OR (activity_at = @ts AND post_id < @cid))';

/**
 * 热度分（带时间衰减）：(赞 + 转发×2 + 回复) ÷ (帖龄小时 + 2)。
 * 帖龄按模拟时间计算；分数随时间下降，游标分页存在轻微不稳定（可接受）。
 */
const HOT_SCORE = `
  (p.like_count + p.repost_count * 2 + p.reply_count) * 1.0
  / ((@now - p.created_at) / 3600000.0 + 2)
`;

const HOT_CURSOR_CLAUSE = 'WHERE (score < @cs OR (score = @cs AND post_id < @cid))';

const ENTRY_COLUMNS = `
  p.id          AS post_id,
  p.created_at  AS activity_at,
  'post'        AS item_type,
  NULL          AS actor_id,
  NULL          AS actor_handle,
  NULL          AS actor_display_name,
  NULL          AS actor_is_bot,
  NULL          AS actor_avatar_media_id
`;

export const timelineRepo = {
  /**
   * 关注流（最新）：关注者的原创帖（非回复）+ 关注者的转发。
   * 不含自己的帖子与转发——关注流只呈现"关注的人"的动态。
   */
  homeLatestEntries(
    db: WorldDb,
    userId: number,
    before: { ts: number; id: number } | null,
    limit: number,
  ): TimelineEntryRow[] {
    return db
      .prepare(
        `SELECT * FROM (
           SELECT ${ENTRY_COLUMNS}
           FROM posts p
           WHERE p.deleted = 0 AND p.reply_to_id IS NULL
             AND p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = @userId)
             ${NOT_BLOCKED_AUTHOR} ${NOT_HIDDEN}
           UNION ALL
           SELECT r.post_id,
                  r.created_at,
                  'repost',
                  u.id, u.handle, u.display_name, u.is_bot, u.avatar_media_id
           FROM reposts r
           JOIN users u ON u.id = r.user_id
           JOIN posts p ON p.id = r.post_id
           WHERE p.deleted = 0
             AND r.user_id IN (SELECT followee_id FROM follows WHERE follower_id = @userId)
             ${NOT_BLOCKED_REPOSTER} ${NOT_BLOCKED_AUTHOR} ${NOT_HIDDEN}
         )
         ${before ? CURSOR_CLAUSE : ''}
         ORDER BY activity_at DESC, post_id DESC
         LIMIT @limit`,
      )
      .all({
        userId,
        viewerId: userId,
        limit,
        ...(before ? { ts: before.ts, cid: before.id } : {}),
      }) as TimelineEntryRow[];
  },

  /** 关注流（热度）：关注者的原创帖按衰减热度分排序（不含转发条目） */
  homeHotEntries(
    db: WorldDb,
    userId: number,
    now: number,
    before: { score: number; id: number } | null,
    limit: number,
  ): (TimelineEntryRow & { score: number })[] {
    return db
      .prepare(
        `SELECT * FROM (
           SELECT ${ENTRY_COLUMNS}, ${HOT_SCORE} AS score
           FROM posts p
           WHERE p.deleted = 0 AND p.reply_to_id IS NULL
             AND p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = @userId)
             ${NOT_BLOCKED_AUTHOR} ${NOT_HIDDEN}
         )
         ${before ? HOT_CURSOR_CLAUSE : ''}
         ORDER BY score DESC, post_id DESC
         LIMIT @limit`,
      )
      .all({
        userId,
        viewerId: userId,
        now,
        limit,
        ...(before ? { cs: before.score, cid: before.id } : {}),
      }) as (TimelineEntryRow & { score: number })[];
  },

  /** 为你推荐：全站原创帖按衰减热度分排序 */
  forYouEntries(
    db: WorldDb,
    viewerId: number | null,
    now: number,
    before: { score: number; id: number } | null,
    limit: number,
  ): (TimelineEntryRow & { score: number })[] {
    const viewerClause = viewerId !== null ? `${NOT_BLOCKED_AUTHOR} ${NOT_HIDDEN}` : '';
    return db
      .prepare(
        `SELECT * FROM (
           SELECT ${ENTRY_COLUMNS}, ${HOT_SCORE} AS score
           FROM posts p
           WHERE p.deleted = 0 AND p.reply_to_id IS NULL ${viewerClause}
         )
         ${before ? HOT_CURSOR_CLAUSE : ''}
         ORDER BY score DESC, post_id DESC
         LIMIT @limit`,
      )
      .all({
        now,
        limit,
        ...(viewerId !== null ? { viewerId } : {}),
        ...(before ? { cs: before.score, cid: before.id } : {}),
      }) as (TimelineEntryRow & { score: number })[];
  },

  /** 全站流：所有原创帖（非回复），按时间 */
  globalEntries(
    db: WorldDb,
    viewerId: number | null,
    before: { ts: number; id: number } | null,
    limit: number,
  ): TimelineEntryRow[] {
    const viewerClause = viewerId !== null ? `${NOT_BLOCKED_AUTHOR} ${NOT_HIDDEN}` : '';
    return db
      .prepare(
        `SELECT * FROM (
           SELECT ${ENTRY_COLUMNS}
           FROM posts p
           WHERE p.deleted = 0 AND p.reply_to_id IS NULL ${viewerClause}
         )
         ${before ? CURSOR_CLAUSE : ''}
         ORDER BY activity_at DESC, post_id DESC
         LIMIT @limit`,
      )
      .all({
        limit,
        ...(viewerId !== null ? { viewerId } : {}),
        ...(before ? { ts: before.ts, cid: before.id } : {}),
      }) as TimelineEntryRow[];
  },

  /**
   * 单个用户的"帖子"时间线：本人原创帖 + 本人的转发（个人主页帖子 Tab，与 X 一致）。
   * 主动访问场景，不做屏蔽/隐藏过滤；置顶帖由前端单独渲染在顶部，原创段排除防重复。
   */
  userEntries(
    db: WorldDb,
    userId: number,
    pinnedPostId: number | null,
    before: { ts: number; id: number } | null,
    limit: number,
  ): TimelineEntryRow[] {
    const pinnedClause = pinnedPostId !== null ? 'AND p.id != @pinnedId' : '';
    return db
      .prepare(
        `SELECT * FROM (
           SELECT ${ENTRY_COLUMNS}
           FROM posts p
           WHERE p.deleted = 0 AND p.reply_to_id IS NULL AND p.author_id = @userId ${pinnedClause}
           UNION ALL
           SELECT r.post_id,
                  r.created_at,
                  'repost',
                  u.id, u.handle, u.display_name, u.is_bot, u.avatar_media_id
           FROM reposts r
           JOIN users u ON u.id = r.user_id
           JOIN posts p ON p.id = r.post_id
           WHERE p.deleted = 0 AND r.user_id = @userId
         )
         ${before ? CURSOR_CLAUSE : ''}
         ORDER BY activity_at DESC, post_id DESC
         LIMIT @limit`,
      )
      .all({
        userId,
        limit,
        ...(pinnedPostId !== null ? { pinnedId: pinnedPostId } : {}),
        ...(before ? { ts: before.ts, cid: before.id } : {}),
      }) as TimelineEntryRow[];
  },
};
