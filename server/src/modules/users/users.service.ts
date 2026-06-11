import type { UpdateProfileRequest, UserProfile, UserSummary } from '@socialsim/shared';
import { NotFoundError, ValidationError } from '../../core/errors/app-error.js';
import type { WorldManager } from '../../core/world/world-manager.js';
import type { MediaService } from '../media/media.service.js';
import { toUser, usersRepo, type UserRow } from './users.repo.js';

export class UsersService {
  constructor(
    private readonly worldManager: WorldManager,
    private readonly mediaService: MediaService,
  ) {}

  /** media id → 公开文件 URL（null 透传） */
  avatarUrlOf(mediaId: number | null): string | null {
    return mediaId !== null ? this.mediaService.fileUrl(mediaId) : null;
  }

  /** 推荐关注列表（粉丝最多的人，排除自己与已关注） */
  suggested(viewerId: number | null, limit = 5): (UserSummary & { followerCount: number })[] {
    const { db } = this.worldManager.current();
    return usersRepo.suggested(db, viewerId, limit).map((r) => ({
      id: r.id,
      handle: r.handle,
      displayName: r.display_name,
      isBot: r.is_bot === 1,
      avatarUrl: this.avatarUrlOf(r.avatar_media_id),
      followerCount: r.follower_count,
    }));
  }

  /** 按 handle 找用户 id；不存在返回 null（@mention 解析等场景，不抛错） */
  findIdByHandle(handle: string): number | null {
    const { db } = this.worldManager.current();
    return usersRepo.findByHandle(db, handle)?.id ?? null;
  }

  getProfileByHandle(handle: string, viewerId: number | null = null): UserProfile {
    const { db } = this.worldManager.current();
    const row = usersRepo.findByHandle(db, handle);
    if (!row) throw new NotFoundError(`用户 @${handle} 不存在`);
    return this.buildProfile(row, viewerId);
  }

  getProfileById(id: number, viewerId: number | null = null): UserProfile {
    const { db } = this.worldManager.current();
    const row = usersRepo.findById(db, id);
    if (!row) throw new NotFoundError(`用户 #${id} 不存在`);
    return this.buildProfile(row, viewerId);
  }

  updateMe(userId: number, patch: UpdateProfileRequest): UserProfile {
    if (patch.displayName !== undefined && patch.displayName.trim().length === 0) {
      throw new ValidationError('昵称不能为空');
    }
    if (patch.avatarMediaId !== undefined && patch.avatarMediaId !== null) {
      this.mediaService.validateOwnedImage(userId, patch.avatarMediaId);
    }
    if (patch.bannerMediaId !== undefined && patch.bannerMediaId !== null) {
      this.mediaService.validateOwnedImage(userId, patch.bannerMediaId);
    }
    const { db } = this.worldManager.current();
    usersRepo.updateProfile(db, userId, {
      ...(patch.displayName !== undefined ? { displayName: patch.displayName.trim() } : {}),
      ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
      ...(patch.avatarMediaId !== undefined ? { avatarMediaId: patch.avatarMediaId } : {}),
      ...(patch.bannerMediaId !== undefined ? { bannerMediaId: patch.bannerMediaId } : {}),
    });
    return this.getProfileById(userId);
  }

  /** 置顶帖写入（校验在 posts.service 完成；新置顶天然替换旧值） */
  setPinnedPost(userId: number, postId: number): void {
    const { db } = this.worldManager.current();
    usersRepo.setPinnedPostId(db, userId, postId);
  }

  /** 取消置顶/删除帖子时清除；仅当当前置顶正是该帖时生效 */
  clearPinnedPost(userId: number, postId: number): void {
    const { db } = this.worldManager.current();
    usersRepo.clearPinnedIfMatches(db, userId, postId);
  }

  private buildProfile(row: UserRow, viewerId: number | null = null): UserProfile {
    const { db } = this.worldManager.current();
    return {
      ...toUser(row),
      ...usersRepo.counts(db, row.id),
      followedByViewer:
        viewerId !== null && viewerId !== row.id && usersRepo.isFollowedBy(db, row.id, viewerId),
      blockedByViewer:
        viewerId !== null && viewerId !== row.id && usersRepo.isBlocking(db, viewerId, row.id),
      pinnedPostId: row.pinned_post_id,
      avatarUrl: this.avatarUrlOf(row.avatar_media_id),
      bannerUrl: this.avatarUrlOf(row.banner_media_id),
      avatarMediaId: row.avatar_media_id,
      bannerMediaId: row.banner_media_id,
    };
  }
}
