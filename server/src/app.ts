import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { makeRequireAuth } from './core/auth/auth-guard.js';
import { AppError } from './core/errors/app-error.js';
import type { WorldManager } from './core/world/world-manager.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { AuthService } from './modules/auth/auth.service.js';
import { registerUsersRoutes } from './modules/users/users.routes.js';
import { UsersService } from './modules/users/users.service.js';
import { registerWorldsRoutes } from './modules/worlds/worlds.routes.js';

export interface AppDeps {
  worldManager: WorldManager;
  jwtSecret: string;
}

/** 组装层：创建实例、挂错误处理、构建各模块 service 并注册路由 */
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: true });

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err.validation) {
      reply.status(400).send({ error: { code: 'VALIDATION', message: err.message } });
      return;
    }
    // Fastify 自身的协议类错误（415/404/413…）保留原状态码，不伪装成 500
    if (err.statusCode && err.statusCode < 500) {
      reply.status(err.statusCode).send({ error: { code: err.code ?? 'BAD_REQUEST', message: err.message } });
      return;
    }
    req.log.error(err);
    reply.status(500).send({ error: { code: 'INTERNAL', message: '服务器内部错误' } });
  });

  app.register(fastifyJwt, { secret: deps.jwtSecret });

  const { worldManager } = deps;
  const requireAuth = makeRequireAuth(worldManager);
  const usersService = new UsersService(worldManager);
  const authService = new AuthService(worldManager, usersService);

  app.get('/api/health', async () => ({ ok: true }));

  registerWorldsRoutes(app, { worldManager });
  registerAuthRoutes(app, { authService, worldManager, requireAuth });
  registerUsersRoutes(app, { usersService, requireAuth });

  return app;
}
