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
