import type { LoginRequest, RegisterRequest, UserProfile } from '@socialsim/shared';
import {
  ConflictError,
  UnauthorizedError,
  ValidationError,
} from '../../core/errors/app-error.js';
import type { WorldManager } from '../../core/world/world-manager.js';
import type { UsersService } from '../users/users.service.js';
import { authRepo } from './auth.repo.js';
import { hashPassword, verifyPassword } from './password.js';

const HANDLE_PATTERN = /^[a-zA-Z0-9_]{2,20}$/;
const MIN_PASSWORD_LENGTH = 6;

export class AuthService {
  constructor(
    private readonly worldManager: WorldManager,
    private readonly usersService: UsersService,
  ) {}

  register(input: RegisterRequest): UserProfile {
    if (!HANDLE_PATTERN.test(input.handle)) {
      throw new ValidationError('handle 只能由字母、数字、下划线组成（2-20 字符）');
    }
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      throw new ValidationError(`密码至少 ${MIN_PASSWORD_LENGTH} 位`);
    }
    const displayName = input.displayName.trim();
    if (displayName.length === 0) {
      throw new ValidationError('昵称不能为空');
    }

    const { db, clock } = this.worldManager.current();
    if (authRepo.handleExists(db, input.handle)) {
      throw new ConflictError(`@${input.handle} 已被注册`);
    }
    const id = authRepo.insertUser(db, {
      handle: input.handle,
      displayName,
      passwordHash: hashPassword(input.password),
      createdAt: clock.now(),
    });
    return this.usersService.getProfileById(id);
  }

  login(input: LoginRequest): UserProfile {
    const { db } = this.worldManager.current();
    const credentials = authRepo.findCredentials(db, input.handle);
    if (!credentials || !verifyPassword(input.password, credentials.password_hash)) {
      throw new UnauthorizedError('用户名或密码错误');
    }
    return this.usersService.getProfileById(credentials.id);
  }

  me(userId: number): UserProfile {
    return this.usersService.getProfileById(userId);
  }
}
