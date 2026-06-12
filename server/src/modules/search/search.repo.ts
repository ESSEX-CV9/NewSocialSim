import type { WorldDb } from '../../core/db/database.js';
import { NOT_BLOCKED_AUTHOR, NOT_HIDDEN, type PostRow } from '../posts/posts.repo.js';

export interface SearchUserRow {
  id: number;
  handle: string;
  display_name: string;
  is_bot: number;
  avatar_media_id: number | null;
}

/** LIKE 通配符转义：让用户输入的 % _ 按字面匹配 */
function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export const searchRepo = {
  /** 帖子按内容子串匹配，新帖在前；M4 之后可平滑替换为 FTS5 */
  searchPosts(
    db: WorldDb,
    query: string,
    viewerId: number | null,
    beforeId: number | null,
    limit: number,
  ): PostRow[] {
    const cursorClause = beforeId !== null ? 'AND p.id < @beforeId' : '';
    const viewerClause = viewerId !== null ? `${NOT_BLOCKED_AUTHOR} ${NOT_HIDDEN}` : '';
    return db
      .prepare(
        `SELECT p.*,
                u.handle          AS author_handle,
                u.display_name    AS author_display_name,
                u.is_bot          AS author_is_bot,
                u.avatar_media_id AS author_avatar_media_id
         FROM posts p
         JOIN users u ON u.id = p.author_id
         WHERE p.deleted = 0
           AND p.content LIKE @pattern ESCAPE '\\' ${viewerClause} ${cursorClause}
         ORDER BY p.id DESC
         LIMIT @limit`,
      )
      .all({
        pattern: `%${escapeLike(query)}%`,
        limit,
        ...(viewerId !== null ? { viewerId } : {}),
        ...(beforeId !== null ? { beforeId } : {}),
      }) as PostRow[];
  },

  /** 近期含 # 的帖子正文（LIKE 预筛，话题解析在 service 的 JS 端进行） */
  recentHashtagContents(db: WorldDb, sinceTs: number): { content: string }[] {
    return db
      .prepare(
        `SELECT content FROM posts
         WHERE deleted = 0 AND created_at >= ? AND content LIKE '%#%'`,
      )
      .all(sinceTs) as { content: string }[];
  },

  searchUsers(db: WorldDb, query: string, beforeId: number | null, limit: number): SearchUserRow[] {
    const cursorClause = beforeId !== null ? 'AND id < @beforeId' : '';
    return db
      .prepare(
        `SELECT id, handle, display_name, is_bot, avatar_media_id
         FROM users
         WHERE (handle LIKE @pattern ESCAPE '\\' OR display_name LIKE @pattern ESCAPE '\\')
           ${cursorClause}
         ORDER BY id DESC
         LIMIT @limit`,
      )
      .all({
        pattern: `%${escapeLike(query)}%`,
        limit,
        ...(beforeId !== null ? { beforeId } : {}),
      }) as SearchUserRow[];
  },
};
