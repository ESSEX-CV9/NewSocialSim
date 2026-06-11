import type { User } from '@socialsim/shared';
import type { WorldDb } from '../../core/db/database.js';

/** users 表的原始行（snake_case，含敏感字段，不得越过 service 层外泄） */
export interface UserRow {
  id: number;
  handle: string;
  display_name: string;
  bio: string;
  password_hash: string;
  is_bot: number;
  created_at: number;
}

export interface UserCounts {
  followerCount: number;
  followingCount: number;
  postCount: number;
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    bio: row.bio,
    isBot: row.is_bot === 1,
    createdAt: row.created_at,
  };
}

export const usersRepo = {
  findById(db: WorldDb, id: number): UserRow | undefined {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  },

  findByHandle(db: WorldDb, handle: string): UserRow | undefined {
    return db.prepare('SELECT * FROM users WHERE handle = ?').get(handle) as UserRow | undefined;
  },

  counts(db: WorldDb, userId: number): UserCounts {
    const row = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM follows WHERE followee_id = @id) AS followerCount,
           (SELECT COUNT(*) FROM follows WHERE follower_id = @id) AS followingCount,
           (SELECT COUNT(*) FROM posts   WHERE author_id   = @id) AS postCount`,
      )
      .get({ id: userId }) as UserCounts;
    return row;
  },

  /** 推荐关注：按粉丝数倒序，排除自己与已关注（viewerId 为 null 时不排除） */
  suggested(
    db: WorldDb,
    viewerId: number | null,
    limit: number,
  ): { id: number; handle: string; display_name: string; is_bot: number; follower_count: number }[] {
    const excludeClause =
      viewerId !== null
        ? 'WHERE u.id != @viewerId AND u.id NOT IN (SELECT followee_id FROM follows WHERE follower_id = @viewerId)'
        : '';
    return db
      .prepare(
        `SELECT u.id, u.handle, u.display_name, u.is_bot,
                (SELECT COUNT(*) FROM follows WHERE followee_id = u.id) AS follower_count
         FROM users u
         ${excludeClause}
         ORDER BY follower_count DESC, u.id ASC
         LIMIT @limit`,
      )
      .all({ limit, ...(viewerId !== null ? { viewerId } : {}) }) as {
      id: number;
      handle: string;
      display_name: string;
      is_bot: number;
      follower_count: number;
    }[];
  },

  isFollowedBy(db: WorldDb, targetId: number, viewerId: number): boolean {
    return (
      db
        .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?')
        .get(viewerId, targetId) !== undefined
    );
  },

  updateProfile(
    db: WorldDb,
    userId: number,
    patch: { displayName?: string; bio?: string },
  ): void {
    if (patch.displayName !== undefined) {
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(patch.displayName, userId);
    }
    if (patch.bio !== undefined) {
      db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(patch.bio, userId);
    }
  },
};
