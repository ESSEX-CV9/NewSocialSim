import type { preHandlerHookHandler } from 'fastify';
import { UnauthorizedError } from '../errors/app-error.js';
import type { WorldManager } from '../world/world-manager.js';

/** JWT 负载：登录态绑定签发时的世界，热切换后旧 token 自动失效 */
export interface AuthTokenPayload {
  /** 用户 id */
  sub: number;
  worldId: string;
  handle: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthTokenPayload;
    user: AuthTokenPayload;
  }
}

/**
 * 需要登录的路由共用的 preHandler：
 * 校验 JWT 本身，并确认其 worldId 与当前活动世界一致。
 */
/**
 * 可选登录：带有效 token 时填充 req.user（用于"我是否赞过"等观察者状态），
 * 匿名或 token 属于其他世界时按未登录处理，不报错。
 */
export function makeOptionalAuth(worldManager: WorldManager): preHandlerHookHandler {
  return async function optionalAuth(req) {
    try {
      await req.jwtVerify();
      if (req.user.worldId !== worldManager.current().worldId) {
        (req as { user: AuthTokenPayload | undefined }).user = undefined;
      }
    } catch {
      // 匿名访问
    }
  };
}

/** 读取观察者 id；未登录（或 optionalAuth 判为匿名）时为 null */
export function viewerIdOf(req: { user?: AuthTokenPayload }): number | null {
  return req.user?.sub ?? null;
}

export function makeRequireAuth(worldManager: WorldManager): preHandlerHookHandler {
  return async function requireAuth(req) {
    try {
      await req.jwtVerify();
    } catch {
      throw new UnauthorizedError('未登录或登录已过期');
    }
    if (req.user.worldId !== worldManager.current().worldId) {
      throw new UnauthorizedError('登录态属于另一个世界，请重新登录');
    }
  };
}
