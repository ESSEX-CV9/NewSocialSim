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
  reply_count: number;
  deleted: number;
  author_handle: string;
  author_display_name: string;
  author_is_bot: number;
}

const SELECT_POST = `
  SELECT p.*,
         u.handle       AS author_handle,
         u.display_name AS author_display_name,
         u.is_bot       AS author_is_bot
  FROM posts p
  JOIN users u ON u.id = p.author_id
`;

export interface CountDeltas {
  like?: number;
  repost?: number;
  reply?: number;
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

  listReplies(
    db: WorldDb,
    postId: number,
    before: { ts: number; id: number } | null,
    limit: number,
  ): PostRow[] {
    const cursorClause = before
      ? 'AND (p.created_at < @ts OR (p.created_at = @ts AND p.id < @cid))'
      : '';
    return db
      .prepare(
        `${SELECT_POST}
         WHERE p.reply_to_id = @postId AND p.deleted = 0 ${cursorClause}
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT @limit`,
      )
      .all({ postId, limit, ...(before ? { ts: before.ts, cid: before.id } : {}) }) as PostRow[];
  },

  listByAuthor(
    db: WorldDb,
    authorId: number,
    repliesOnly: boolean,
    before: { ts: number; id: number } | null,
    limit: number,
  ): PostRow[] {
    const cursorClause = before
      ? 'AND (p.created_at < @ts OR (p.created_at = @ts AND p.id < @cid))'
      : '';
    const replyClause = repliesOnly ? 'AND p.reply_to_id IS NOT NULL' : 'AND p.reply_to_id IS NULL';
    return db
      .prepare(
        `${SELECT_POST}
         WHERE p.author_id = @authorId AND p.deleted = 0 ${replyClause} ${cursorClause}
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
                u.handle       AS author_handle,
                u.display_name AS author_display_name,
                u.is_bot       AS author_is_bot,
                l.created_at   AS liked_at
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
         reply_count  = reply_count  + @reply
       WHERE id = @postId`,
    ).run({ postId, like: deltas.like ?? 0, repost: deltas.repost ?? 0, reply: deltas.reply ?? 0 });
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

  interactionSet(
    db: WorldDb,
    table: 'likes' | 'reposts',
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
