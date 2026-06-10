import type { UpdateProfileRequest, UserProfile } from '@socialsim/shared';
import { NotFoundError, ValidationError } from '../../core/errors/app-error.js';
import type { WorldManager } from '../../core/world/world-manager.js';
import { toUser, usersRepo, type UserRow } from './users.repo.js';

export class UsersService {
  constructor(private readonly worldManager: WorldManager) {}

  getProfileByHandle(handle: string): UserProfile {
    const { db } = this.worldManager.current();
    const row = usersRepo.findByHandle(db, handle);
    if (!row) throw new NotFoundError(`用户 @${handle} 不存在`);
    return this.buildProfile(row);
  }

  getProfileById(id: number): UserProfile {
    const { db } = this.worldManager.current();
    const row = usersRepo.findById(db, id);
    if (!row) throw new NotFoundError(`用户 #${id} 不存在`);
    return this.buildProfile(row);
  }

  updateMe(userId: number, patch: UpdateProfileRequest): UserProfile {
    if (patch.displayName !== undefined && patch.displayName.trim().length === 0) {
      throw new ValidationError('昵称不能为空');
    }
    const { db } = this.worldManager.current();
    usersRepo.updateProfile(db, userId, {
      ...(patch.displayName !== undefined ? { displayName: patch.displayName.trim() } : {}),
      ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
    });
    return this.getProfileById(userId);
  }

  private buildProfile(row: UserRow): UserProfile {
    const { db } = this.worldManager.current();
    return { ...toUser(row), ...usersRepo.counts(db, row.id) };
  }
}
