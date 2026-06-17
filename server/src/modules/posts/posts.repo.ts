import type { WorldDb } from '../../core/db/database.js';

/** posts JOIN users 的原始行 */
export interface PostRow {
  id: number;
  author_id: number;
  content: string;
  reply_to_id: number | null;
  quote_of_id: number | null;
  created_at: number;
  like_count: number;
  repost_count: number;
  quote_count: number;
  reply_count: number;
  view_count: number;
  deleted: number;
  author_handle: string;
  author_display_name: string;
  author_is_bot: number;
  author_avatar_media_id: number | null;
  author_verified: string;
}

const SELECT_POST = `
  SELECT p.*,
         u.handle          AS author_handle,
         u.display_name    AS author_display_name,
         u.is_bot          AS author_is_bot,
         u.avatar_media_id AS author_avatar_media_id,
         u.verified        AS author_verified
  FROM posts p
  JOIN users u ON u.id = p.author_id
`;

/** 观察者过滤：排除被屏蔽作者与被隐藏帖（@viewerId；匿名时不拼接） */
export const NOT_BLOCKED_AUTHOR =
  'AND p.author_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = @viewerId)';
export const NOT_HIDDEN =
  'AND p.id NOT IN (SELECT post_id FROM hidden_posts WHERE user_id = @viewerId)';

export interface CountDeltas {
  like?: number;
  repost?: number;
  quote?: number;
  reply?: number;
  view?: number;
}

export const postsRepo = {
  insert(
    db: WorldDb,
    input: {
      authorId: number;
      content: string;
      replyToId: number | null;
      quoteOfId: number | null;
      createdAt: number;
    },
  ): number {
    const result = db
      .prepare(
        `INSERT INTO posts (author_id, content, reply_to_id, quote_of_id, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.authorId, input.content, input.replyToId, input.quoteOfId, input.createdAt);
    return Number(result.lastInsertRowid);
  },

  findById(db: WorldDb, id: number): PostRow | undefined {
    return db.prepare(`${SELECT_POST} WHERE p.id = ?`).get(id) as PostRow | undefined;
  },

  findByIds(db: WorldDb, ids: number[]): PostRow[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return db.prepare(`${SELECT_POST} WHERE p.id IN (${placeholders})`).all(...ids) as PostRow[];
  },

  /** 批量查询中对观察者可见的帖子：排除已删除、被屏蔽作者与被隐藏帖 */
  findVisibleByIds(db: WorldDb, ids: number[], viewerId: number | null): PostRow[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map((_, i) => `@id${i}`).join(',');
    const viewerClause = viewerId !== null ? `${NOT_BLOCKED_AUTHOR} ${NOT_HIDDEN}` : '';
    const params: Record<string, number> = {};
    ids.forEach((id, i) => (params[`id${i}`] = id));
    if (viewerId !== null) params['viewerId'] = viewerId;
    return db
      .prepare(
        `${SELECT_POST} WHERE p.id IN (${placeholders}) AND p.deleted = 0 ${viewerClause}`,
      )
      .all(params) as PostRow[];
  },

  listReplies(
    db: WorldDb,
    postId: number,
    viewerId: number | null,
    before: { ts: number; id: number } | null,
    limit: number,
  ): PostRow[] {
    const cursorClause = before
      ? 'AND (p.created_at < @ts OR (p.created_at = @ts AND p.id < @cid))'
      : '';
    const viewerClause = viewerId !== null ? `${NOT_BLOCKED_AUTHOR} ${NOT_HIDDEN}` : '';
    return db
      .prepare(
        `${SELECT_POST}
         WHERE p.reply_to_id = @postId AND p.deleted = 0 ${viewerClause} ${cursorClause}
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT @limit`,
      )
      .all({
        postId,
        limit,
        ...(viewerId !== null ? { viewerId } : {}),
        ...(before ? { ts: before.ts, cid: before.id } : {}),
      }) as PostRow[];
  },

  listByAuthor(
    db: WorldDb,
    authorId: number,
    repliesOnly: boolean,
    before: { ts: number; id: number } | null,
    limit: number,
    range?: { from?: number | undefined; to?: number | undefined },
  ): PostRow[] {
    const cursorClause = before
      ? 'AND (p.created_at < @ts OR (p.created_at = @ts AND p.id < @cid))'
      : '';
    const replyClause = repliesOnly ? 'AND p.reply_to_id IS NOT NULL' : 'AND p.reply_to_id IS NULL';
    // 时间区间（时间轴按可见窗口取回复）
    const rangeClause =
      (range?.from != null ? 'AND p.created_at >= @from ' : '') + (range?.to != null ? 'AND p.created_at <= @to' : '');
    return db
      .prepare(
        `${SELECT_POST}
         WHERE p.author_id = @authorId AND p.deleted = 0 ${replyClause} ${cursorClause} ${rangeClause}
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT @limit`,
      )
      .all({
        authorId,
        limit,
        ...(before ? { ts: before.ts, cid: before.id } : {}),
        ...(range?.from != null ? { from: range.from } : {}),
        ...(range?.to != null ? { to: range.to } : {}),
      }) as PostRow[];
  },

  /** 某用户带媒体的帖子（含回复，与 X 媒体 Tab 一致），按发布时间倒序 */
  listMediaPostsByAuthor(
    db: WorldDb,
    authorId: number,
    before: { ts: number; id: number } | null,
    limit: number,
  ): PostRow[] {
    const cursorClause = before
      ? 'AND (p.created_at < @ts OR (p.created_at = @ts AND p.id < @cid))'
      : '';
    return db
      .prepare(
        `${SELECT_POST}
         WHERE p.author_id = @authorId AND p.deleted = 0
           AND EXISTS (SELECT 1 FROM post_media pm WHERE pm.post_id = p.id)
           ${cursorClause}
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT @limit`,
      )
      .all({ authorId, limit, ...(before ? { ts: before.ts, cid: before.id } : {}) }) as PostRow[];
  },

  /** 某用户赞过的帖子，按点赞时间倒序；liked_at 供游标使用 */
  listLikedBy(
    db: WorldDb,
    userId: number,
    before: { ts: number; id: number } | null,
    limit: number,
  ): (PostRow & { liked_at: number })[] {
    const cursorClause = before
      ? 'AND (l.created_at < @ts OR (l.created_at = @ts AND p.id < @cid))'
      : '';
    return db
      .prepare(
        `SELECT p.*,
                u.handle          AS author_handle,
                u.display_name    AS author_display_name,
                u.is_bot          AS author_is_bot,
                u.avatar_media_id AS author_avatar_media_id,
                u.verified        AS author_verified,
                l.created_at      AS liked_at
         FROM likes l
         JOIN posts p ON p.id = l.post_id
         JOIN users u ON u.id = p.author_id
         WHERE l.user_id = @userId AND p.deleted = 0 ${cursorClause}
         ORDER BY l.created_at DESC, p.id DESC
         LIMIT @limit`,
      )
      .all({ userId, limit, ...(before ? { ts: before.ts, cid: before.id } : {}) }) as (PostRow & {
      liked_at: number;
    })[];
  },

  adjustCounts(db: WorldDb, postId: number, deltas: CountDeltas): void {
    db.prepare(
      `UPDATE posts SET
         like_count   = like_count   + @like,
         repost_count = repost_count + @repost,
         quote_count  = quote_count  + @quote,
         reply_count  = reply_count  + @reply,
         view_count   = view_count   + @view
       WHERE id = @postId`,
    ).run({
      postId,
      like: deltas.like ?? 0,
      repost: deltas.repost ?? 0,
      quote: deltas.quote ?? 0,
      reply: deltas.reply ?? 0,
      view: deltas.view ?? 0,
    });
  },

  /** 批量曝光 +1：不存在/已删除的 id 自动忽略 */
  incrementViewCounts(db: WorldDb, ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(
      `UPDATE posts SET view_count = view_count + 1 WHERE id IN (${placeholders}) AND deleted = 0`,
    ).run(...ids);
  },

  markDeleted(db: WorldDb, postId: number): void {
    db.prepare("UPDATE posts SET deleted = 1, content = '' WHERE id = ?").run(postId);
  },

  /** 观察者赞过/转发过的帖子 id 集合（用于批量构建视图） */
  likedSet(db: WorldDb, userId: number, postIds: number[]): Set<number> {
    return this.interactionSet(db, 'likes', userId, postIds);
  },

  repostedSet(db: WorldDb, userId: number, postIds: number[]): Set<number> {
    return this.interactionSet(db, 'reposts', userId, postIds);
  },

  bookmarkedSet(db: WorldDb, userId: number, postIds: number[]): Set<number> {
    return this.interactionSet(db, 'bookmarks', userId, postIds);
  },

  /** 观察者已关注的作者 id 集合（批量构建视图时补 authorFollowedByViewer） */
  followedAuthorSet(db: WorldDb, viewerId: number, authorIds: number[]): Set<number> {
    if (authorIds.length === 0) return new Set();
    const placeholders = authorIds.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT followee_id FROM follows WHERE follower_id = ? AND followee_id IN (${placeholders})`,
      )
      .all(viewerId, ...authorIds) as { followee_id: number }[];
    return new Set(rows.map((r) => r.followee_id));
  },

  interactionSet(
    db: WorldDb,
    table: 'likes' | 'reposts' | 'bookmarks',
    userId: number,
    postIds: number[],
  ): Set<number> {
    if (postIds.length === 0) return new Set();
    const placeholders = postIds.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT post_id FROM ${table} WHERE user_id = ? AND post_id IN (${placeholders})`,
      )
      .all(userId, ...postIds) as { post_id: number }[];
    return new Set(rows.map((r) => r.post_id));
  },
};
