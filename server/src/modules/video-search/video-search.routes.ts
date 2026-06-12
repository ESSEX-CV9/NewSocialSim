import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { VideoSearchController } from './video-search.controller.js';
import type { IngestMode, VideoSearchService } from './video-search.service.js';

const ingestBodySchema = {
  type: 'object',
  required: ['url'],
  additionalProperties: false,
  properties: {
    url: { type: 'string', minLength: 1, maxLength: 2048 },
    mode: { type: 'string', enum: ['auto', 'download', 'stream'] },
  },
} as const;

const taskParamsSchema = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string', minLength: 1, maxLength: 50 } },
} as const;

const streamParamsSchema = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'integer', minimum: 1 } },
} as const;

const streamQuerySchema = {
  type: 'object',
  required: ['w'],
  additionalProperties: false,
  properties: { w: { type: 'string', minLength: 1, maxLength: 100 } },
} as const;

const searchQuerySchema = {
  type: 'object',
  required: ['q'],
  additionalProperties: false,
  properties: {
    q: { type: 'string', minLength: 1, maxLength: 100 },
    source: { type: 'string', maxLength: 20 },
  },
} as const;

export interface VideoSearchRoutesDeps {
  videoSearchService: VideoSearchService;
  requireAuth: preHandlerHookHandler;
}

export function registerVideoSearchRoutes(app: FastifyInstance, deps: VideoSearchRoutesDeps): void {
  const controller = new VideoSearchController(deps.videoSearchService);
  const auth = { preHandler: deps.requireAuth };

  app.post<{ Body: { url: string; mode?: IngestMode } }>(
    '/api/video/ingest',
    { ...auth, schema: { body: ingestBodySchema } },
    controller.ingest,
  );
  app.get('/api/video/sources', auth, controller.sources);
  app.get<{ Querystring: { q: string; source?: string } }>(
    '/api/video/search',
    { ...auth, schema: { querystring: searchQuerySchema } },
    controller.search,
  );
  app.get('/api/video/tasks', auth, controller.tasks);
  app.get<{ Params: { id: string } }>(
    '/api/video/tasks/:id',
    { ...auth, schema: { params: taskParamsSchema } },
    controller.task,
  );
  app.delete<{ Params: { id: string } }>(
    '/api/video/tasks/:id',
    { ...auth, schema: { params: taskParamsSchema } },
    controller.cancel,
  );
  // 流式播放代理公开：video 标签带不了 Authorization 头（与 /file 端点同口径，?w= 把门）
  // 路由由本模块注册（依赖 yt-dlp 解析直链），避免 media 模块反向依赖 video-search
  app.get<{ Params: { id: string }; Querystring: { w: string } }>(
    '/api/media/:id/stream',
    { schema: { params: streamParamsSchema, querystring: streamQuerySchema } },
    controller.stream,
  );
}
