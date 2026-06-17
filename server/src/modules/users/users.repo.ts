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
  pinned_post_id: number | null;
  avatar_media_id: number | null;
  banner_media_id: number | null;
  verified: string;
  website: string | null;
  location: string | null;
  birth_date: string | null;
  profession: string | null;
  verified_at: number | null;
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

  /** 全部账号，按 id 升序、游标 id 之后；供时间轴轨道列全（含从未发帖者）。 */
  listAll(
    db: WorldDb,
    afterId: number | null,
    limit: number,
  ): { id: number; handle: string; display_name: string; avatar_media_id: number | null; verified: string }[] {
    return db
      .prepare(
        `SELECT id, handle, display_name, avatar_media_id, verified
         FROM users
         WHERE (@afterId IS NULL OR id > @afterId)
         ORDER BY id ASC
         LIMIT @limit`,
      )
      .all({ afterId, limit }) as {
      id: number;
      handle: string;
      display_name: string;
      avatar_media_id: number | null;
      verified: string;
    }[];
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
  ): {
    id: number;
    handle: string;
    display_name: string;
    is_bot: number;
    avatar_media_id: number | null;
    verified: string;
    follower_count: number;
  }[] {
    const excludeClause =
      viewerId !== null
        ? `WHERE u.id != @viewerId
           AND u.id NOT IN (SELECT followee_id FROM follows WHERE follower_id = @viewerId)
           AND u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = @viewerId)`
        : '';
    return db
      .prepare(
        `SELECT u.id, u.handle, u.display_name, u.is_bot, u.avatar_media_id, u.verified,
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
      avatar_media_id: number | null;
      verified: string;
      follower_count: number;
    }[];
  },

  /** 观察者关注的人里也关注了 targetId 的（X"你认识的关注者"），按粉丝数倒序取前 limit 个 */
  knownFollowers(
    db: WorldDb,
    targetId: number,
    viewerId: number,
    limit: number,
  ): { rows: { id: number; handle: string; display_name: string; is_bot: number; avatar_media_id: number | null; verified: string }[]; total: number } {
    const condition = `FROM follows f
         JOIN users u ON u.id = f.follower_id
         WHERE f.followee_id = @targetId
           AND f.follower_id IN (SELECT followee_id FROM follows WHERE follower_id = @viewerId)`;
    const rows = db
      .prepare(
        `SELECT u.id, u.handle, u.display_name, u.is_bot, u.avatar_media_id, u.verified
         ${condition}
         ORDER BY (SELECT COUNT(*) FROM follows WHERE followee_id = u.id) DESC, u.id ASC
         LIMIT @limit`,
      )
      .all({ targetId, viewerId, limit }) as {
      id: number;
      handle: string;
      display_name: string;
      is_bot: number;
      avatar_media_id: number | null;
      verified: string;
    }[];
    const total = (
      db.prepare(`SELECT COUNT(*) AS n ${condition}`).get({ targetId, viewerId }) as { n: number }
    ).n;
    return { rows, total };
  },

  isFollowedBy(db: WorldDb, targetId: number, viewerId: number): boolean {
    return (
      db
        .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?')
        .get(viewerId, targetId) !== undefined
    );
  },

  isBlocking(db: WorldDb, viewerId: number, targetId: number): boolean {
    return (
      db
        .prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?')
        .get(viewerId, targetId) !== undefined
    );
  },

  setPinnedPostId(db: WorldDb, userId: number, postId: number | null): void {
    db.prepare('UPDATE users SET pinned_post_id = ? WHERE id = ?').run(postId, userId);
  },

  /** 仅当当前置顶正是该帖时清除（删除帖子时回调用，避免误清新置顶） */
  clearPinnedIfMatches(db: WorldDb, userId: number, postId: number): void {
    db.prepare('UPDATE users SET pinned_post_id = NULL WHERE id = ? AND pinned_post_id = ?').run(
      userId,
      postId,
    );
  },

  updateProfile(
    db: WorldDb,
    userId: number,
    patch: {
      displayName?: string;
      bio?: string;
      avatarMediaId?: number | null;
      bannerMediaId?: number | null;
      verified?: string;
      verifiedAt?: number | null;
      website?: string | null;
      location?: string | null;
      birthDate?: string | null;
      profession?: string | null;
    },
  ): void {
    if (patch.displayName !== undefined) {
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(patch.displayName, userId);
    }
    if (patch.bio !== undefined) {
      db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(patch.bio, userId);
    }
    if (patch.avatarMediaId !== undefined) {
      db.prepare('UPDATE users SET avatar_media_id = ? WHERE id = ?').run(patch.avatarMediaId, userId);
    }
    if (patch.bannerMediaId !== undefined) {
      db.prepare('UPDATE users SET banner_media_id = ? WHERE id = ?').run(patch.bannerMediaId, userId);
    }
    if (patch.verified !== undefined) {
      db.prepare('UPDATE users SET verified = ? WHERE id = ?').run(patch.verified, userId);
    }
    if (patch.verifiedAt !== undefined) {
      db.prepare('UPDATE users SET verified_at = ? WHERE id = ?').run(patch.verifiedAt, userId);
    }
    if (patch.website !== undefined) {
      db.prepare('UPDATE users SET website = ? WHERE id = ?').run(patch.website, userId);
    }
    if (patch.location !== undefined) {
      db.prepare('UPDATE users SET location = ? WHERE id = ?').run(patch.location, userId);
    }
    if (patch.birthDate !== undefined) {
      db.prepare('UPDATE users SET birth_date = ? WHERE id = ?').run(patch.birthDate, userId);
    }
    if (patch.profession !== undefined) {
      db.prepare('UPDATE users SET profession = ? WHERE id = ?').run(patch.profession, userId);
    }
  },
};
