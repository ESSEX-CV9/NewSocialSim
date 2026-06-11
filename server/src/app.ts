import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { makeOptionalAuth, makeRequireAuth } from './core/auth/auth-guard.js';
import { AppError } from './core/errors/app-error.js';
import type { WorldManager } from './core/world/world-manager.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { AuthService } from './modules/auth/auth.service.js';
import { registerFollowsRoutes } from './modules/follows/follows.routes.js';
import { FollowsService } from './modules/follows/follows.service.js';
import { registerInteractionsRoutes } from './modules/interactions/interactions.routes.js';
import { InteractionsService } from './modules/interactions/interactions.service.js';
import { registerNotificationsRoutes } from './modules/notifications/notifications.routes.js';
import { NotificationsService } from './modules/notifications/notifications.service.js';
import { registerPostsRoutes } from './modules/posts/posts.routes.js';
import { PostsService } from './modules/posts/posts.service.js';
import { registerSearchRoutes } from './modules/search/search.routes.js';
import { SearchService } from './modules/search/search.service.js';
import { registerTimelineRoutes } from './modules/timeline/timeline.routes.js';
import { TimelineService } from './modules/timeline/timeline.service.js';
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
  const optionalAuth = makeOptionalAuth(worldManager);

  const usersService = new UsersService(worldManager);
  const authService = new AuthService(worldManager, usersService);
  const notificationsService = new NotificationsService(worldManager);
  const postsService = new PostsService(worldManager, usersService, notificationsService);
  const interactionsService = new InteractionsService(worldManager, postsService, notificationsService);
  const followsService = new FollowsService(worldManager, usersService, notificationsService);
  const timelineService = new TimelineService(worldManager, postsService);
  const searchService = new SearchService(worldManager, postsService);

  app.get('/api/health', async () => ({ ok: true }));

  registerWorldsRoutes(app, { worldManager });
  registerAuthRoutes(app, { authService, worldManager, requireAuth });
  registerUsersRoutes(app, { usersService, requireAuth, optionalAuth });
  registerPostsRoutes(app, { postsService, requireAuth, optionalAuth });
  registerInteractionsRoutes(app, { interactionsService, requireAuth });
  registerFollowsRoutes(app, { followsService, requireAuth });
  registerNotificationsRoutes(app, { notificationsService, requireAuth });
  registerTimelineRoutes(app, { timelineService, requireAuth, optionalAuth });
  registerSearchRoutes(app, { searchService, optionalAuth });

  return app;
}
