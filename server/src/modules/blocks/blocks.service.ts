import { ValidationError } from '../../core/errors/app-error.js';
import type { WorldManager } from '../../core/world/world-manager.js';
import type { FollowsService } from '../follows/follows.service.js';
import type { UsersService } from '../users/users.service.js';
import { blocksRepo } from './blocks.repo.js';

/** 屏蔽为单向隐藏：被屏蔽者的内容从屏蔽者的各内容流消失，对方不受影响、不被告知 */
export class BlocksService {
  constructor(
    private readonly worldManager: WorldManager,
    private readonly usersService: UsersService,
    private readonly followsService: FollowsService,
  ) {}

  block(viewerId: number, handle: string): { blocked: boolean } {
    const target = this.usersService.getProfileByHandle(handle);
    if (target.id === viewerId) throw new ValidationError('不能屏蔽自己');
    const { db, clock } = this.worldManager.current();
    db.transaction(() => {
      blocksRepo.insert(db, viewerId, target.id, clock.now());
      // 屏蔽时自动取消我对他的关注（单向，不动对方对我的关注）
      this.followsService.unfollow(viewerId, handle);
    })();
    return { blocked: true };
  }

  unblock(viewerId: number, handle: string): { blocked: boolean } {
    const target = this.usersService.getProfileByHandle(handle);
    const { db } = this.worldManager.current();
    blocksRepo.remove(db, viewerId, target.id);
    return { blocked: false };
  }
}
