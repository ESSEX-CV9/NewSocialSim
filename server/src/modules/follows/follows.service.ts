import type { Page, UserSummary } from '@socialsim/shared';
import { ValidationError } from '../../core/errors/app-error.js';
import { decodeTsIdCursor, encodeCursor } from '../../core/pagination.js';
import type { WorldManager } from '../../core/world/world-manager.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { UsersService } from '../users/users.service.js';
import { followsRepo } from './follows.repo.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export class FollowsService {
  constructor(
    private readonly worldManager: WorldManager,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
  ) {}

  follow(viewerId: number, handle: string): { following: boolean } {
    const target = this.usersService.getProfileByHandle(handle);
    if (target.id === viewerId) throw new ValidationError('不能关注自己');
    const { db, clock } = this.worldManager.current();
    db.transaction(() => {
      const changed = followsRepo.insert(db, viewerId, target.id, clock.now());
      if (changed) {
        this.notificationsService.add({ userId: target.id, type: 'follow', actorId: viewerId });
      }
    })();
    return { following: true };
  }

  unfollow(viewerId: number, handle: string): { following: boolean } {
    const target = this.usersService.getProfileByHandle(handle);
    const { db } = this.worldManager.current();
    followsRepo.remove(db, viewerId, target.id);
    return { following: false };
  }

  isFollowing(viewerId: number, handle: string): boolean {
    const target = this.usersService.getProfileByHandle(handle);
    const { db } = this.worldManager.current();
    return followsRepo.isFollowing(db, viewerId, target.id);
  }

  followers(handle: string, cursor?: string, limit?: number): Page<UserSummary> {
    return this.listPage(handle, 'followers', cursor, limit);
  }

  following(handle: string, cursor?: string, limit?: number): Page<UserSummary> {
    return this.listPage(handle, 'following', cursor, limit);
  }

  private listPage(
    handle: string,
    direction: 'followers' | 'following',
    cursor?: string,
    limit?: number,
  ): Page<UserSummary> {
    const target = this.usersService.getProfileByHandle(handle);
    const { db } = this.worldManager.current();
    const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, limit ?? DEFAULT_PAGE_SIZE));
    const rows = followsRepo.listUsers(db, target.id, direction, decodeTsIdCursor(cursor), pageSize + 1);
    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
    const last = pageRows[pageRows.length - 1];
    return {
      items: pageRows.map((r) => r.user),
      nextCursor: hasMore && last ? encodeCursor([last.followedAt, last.user.id]) : null,
    };
  }
}
