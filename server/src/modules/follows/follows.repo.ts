import type { UserSummary } from '@socialsim/shared';
import type { WorldDb } from '../../core/db/database.js';

interface FollowUserRow {
  id: number;
  handle: string;
  display_name: string;
  is_bot: number;
  follow_created_at: number;
}

export const followsRepo = {
  insert(db: WorldDb, followerId: number, followeeId: number, createdAt: number): boolean {
    const result = db
      .prepare(
        'INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)',
      )
      .run(followerId, followeeId, createdAt);
    return result.changes > 0;
  },

  remove(db: WorldDb, followerId: number, followeeId: number): boolean {
    const result = db
      .prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?')
      .run(followerId, followeeId);
    return result.changes > 0;
  },

  isFollowing(db: WorldDb, followerId: number, followeeId: number): boolean {
    return (
      db
        .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?')
        .get(followerId, followeeId) !== undefined
    );
  },

  /** direction='followers'：谁关注了 userId；'following'：userId 关注了谁 */
  listUsers(
    db: WorldDb,
    userId: number,
    direction: 'followers' | 'following',
    before: { ts: number; id: number } | null,
    limit: number,
  ): { user: UserSummary; followedAt: number }[] {
    const [matchCol, selectCol] =
      direction === 'followers' ? ['followee_id', 'follower_id'] : ['follower_id', 'followee_id'];
    const cursorClause = before
      ? 'AND (f.created_at < @ts OR (f.created_at = @ts AND u.id < @cid))'
      : '';
    const rows = db
      .prepare(
        `SELECT u.id, u.handle, u.display_name, u.is_bot, f.created_at AS follow_created_at
         FROM follows f
         JOIN users u ON u.id = f.${selectCol}
         WHERE f.${matchCol} = @userId ${cursorClause}
         ORDER BY f.created_at DESC, u.id DESC
         LIMIT @limit`,
      )
      .all({ userId, limit, ...(before ? { ts: before.ts, cid: before.id } : {}) }) as FollowUserRow[];
    return rows.map((r) => ({
      user: { id: r.id, handle: r.handle, displayName: r.display_name, isBot: r.is_bot === 1 },
      followedAt: r.follow_created_at,
    }));
  },
};
