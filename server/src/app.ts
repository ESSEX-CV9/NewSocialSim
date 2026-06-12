import fastifyJwt from '@fastify/jwt';
import fastifyMultipart from '@fastify/multipart';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { makeOptionalAuth, makeRequireAuth } from './core/auth/auth-guard.js';
import { AppError } from './core/errors/app-error.js';
import type { SseHub } from './core/events/sse-hub.js';
import type { WorldManager } from './core/world/world-manager.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { AuthService } from './modules/auth/auth.service.js';
import { registerBlocksRoutes } from './modules/blocks/blocks.routes.js';
import { BlocksService } from './modules/blocks/blocks.service.js';
import { registerFollowsRoutes } from './modules/follows/follows.routes.js';
import { FollowsService } from './modules/follows/follows.service.js';
import { registerInteractionsRoutes } from './modules/interactions/interactions.routes.js';
import { InteractionsService } from './modules/interactions/interactions.service.js';
import { LinkCardsService } from './modules/link-cards/link-cards.service.js';
import { registerMediaRoutes } from './modules/media/media.routes.js';
import { MediaService } from './modules/media/media.service.js';
import { registerMediaSearchRoutes } from './modules/media-search/media-search.routes.js';
import { MediaSearchService } from './modules/media-search/media-search.service.js';
import { readSearchConfig, videoSettings } from './modules/media-search/search-config.js';
import { registerMessagesRoutes } from './modules/messages/messages.routes.js';
import { MessagesService } from './modules/messages/messages.service.js';
import { registerNotificationsRoutes } from './modules/notifications/notifications.routes.js';
import { NotificationsService } from './modules/notifications/notifications.service.js';
import { registerPostsRoutes } from './modules/posts/posts.routes.js';
import { PostsService } from './modules/posts/posts.service.js';
import { registerSearchRoutes } from './modules/search/search.routes.js';
import { SearchService } from './modules/search/search.service.js';
import { registerTimelineRoutes } from './modules/timeline/timeline.routes.js';
import { TimelineService } from './modules/timeline/timeline.service.js';
import { registerToolsRoutes } from './modules/tools/tools.routes.js';
import { ToolsService } from './modules/tools/tools.service.js';
import { registerUsersRoutes } from './modules/users/users.routes.js';
import { UsersService } from './modules/users/users.service.js';
import { registerVideoSearchRoutes } from './modules/video-search/video-search.routes.js';
import { VideoSearchService } from './modules/video-search/video-search.service.js';
import { registerWorldsRoutes } from './modules/worlds/worlds.routes.js';

export interface AppDeps {
  worldManager: WorldManager;
  sseHub: SseHub;
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
  // multipart 是注册期静态上限，只做宽松硬顶；真实视频限额（可配置）在 media.service 校验
  app.register(fastifyMultipart, { limits: { fileSize: 512 * 1024 * 1024, files: 1 } });

  const { worldManager, sseHub } = deps;
  const requireAuth = makeRequireAuth(worldManager);
  const optionalAuth = makeOptionalAuth(worldManager);

  // 组装层穿针：视频限额/镜像源都存于 media-search.json，避免 media/tools 模块依赖 media-search
  const mediaService = new MediaService(worldManager, () => videoSettings(readSearchConfig()).maxBytes);
  const mediaSearchService = new MediaSearchService(worldManager);
  const toolsService = new ToolsService(() => readSearchConfig().tools ?? {});
  const videoSearchService = new VideoSearchService(worldManager, toolsService, mediaService);
  const linkCardsService = new LinkCardsService(worldManager, mediaService);
  const usersService = new UsersService(worldManager, mediaService);
  const authService = new AuthService(worldManager, usersService);
  const notificationsService = new NotificationsService(worldManager);
  const postsService = new PostsService(
    worldManager,
    usersService,
    notificationsService,
    mediaService,
    linkCardsService,
  );
  const interactionsService = new InteractionsService(worldManager, postsService, notificationsService);
  const followsService = new FollowsService(worldManager, usersService, notificationsService);
  const blocksService = new BlocksService(worldManager, usersService, followsService);
  const timelineService = new TimelineService(worldManager, postsService, usersService);
  const searchService = new SearchService(worldManager, postsService);
  const messagesService = new MessagesService(worldManager, mediaService, linkCardsService, sseHub);

  app.get('/api/health', async () => ({ ok: true }));

  registerWorldsRoutes(app, { worldManager });
  registerMediaRoutes(app, { mediaService, requireAuth });
  registerMediaSearchRoutes(app, { mediaSearchService, requireAuth });
  registerToolsRoutes(app, { toolsService, requireAuth });
  registerVideoSearchRoutes(app, { videoSearchService, requireAuth });
  registerAuthRoutes(app, { authService, worldManager, requireAuth });
  registerUsersRoutes(app, { usersService, requireAuth, optionalAuth });
  registerPostsRoutes(app, { postsService, requireAuth, optionalAuth });
  registerInteractionsRoutes(app, { interactionsService, requireAuth });
  registerFollowsRoutes(app, { followsService, requireAuth });
  registerBlocksRoutes(app, { blocksService, requireAuth });
  registerNotificationsRoutes(app, { notificationsService, requireAuth });
  registerMessagesRoutes(app, { messagesService, sseHub, worldManager, requireAuth });
  registerTimelineRoutes(app, { timelineService, requireAuth, optionalAuth });
  registerSearchRoutes(app, { searchService, optionalAuth });

  return app;
}
