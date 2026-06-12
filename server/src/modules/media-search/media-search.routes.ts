import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { MediaSearchController } from './media-search.controller.js';
import type { MediaSearchService } from './media-search.service.js';
import type { MediaSearchConfig } from './search-config.js';

const searchQuerySchema = {
  type: 'object',
  required: ['q'],
  additionalProperties: false,
  properties: {
    q: { type: 'string', minLength: 1, maxLength: 100 },
    source: { type: 'string', maxLength: 20 },
    rating: { type: 'string', enum: ['safe', 'all', 'r18'] },
  },
} as const;

const previewQuerySchema = {
  type: 'object',
  required: ['url'],
  additionalProperties: false,
  properties: { url: { type: 'string', minLength: 1, maxLength: 2048 } },
} as const;

const configBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    proxy: { type: 'string', maxLength: 200 },
    pixiv: {
      type: 'object',
      additionalProperties: false,
      properties: {
        refreshToken: { type: 'string', maxLength: 200 },
        allowR18G: { type: 'boolean' },
      },
    },
    pinterest: {
      type: 'object',
      additionalProperties: false,
      properties: { cookies: { type: 'string', maxLength: 8192 } },
    },
    pexels: {
      type: 'object',
      additionalProperties: false,
      properties: { apiKey: { type: 'string', maxLength: 200 } },
    },
    danbooru: {
      type: 'object',
      additionalProperties: false,
      properties: {
        username: { type: 'string', maxLength: 100 },
        apiKey: { type: 'string', maxLength: 200 },
      },
    },
    gelbooru: {
      type: 'object',
      additionalProperties: false,
      properties: {
        userId: { type: 'string', maxLength: 100 },
        apiKey: { type: 'string', maxLength: 200 },
      },
    },
    tools: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ytdlpUrl: { type: 'string', maxLength: 500 },
        ffmpegUrl: { type: 'string', maxLength: 500 },
      },
    },
  },
} as const;

const codeBodySchema = {
  type: 'object',
  required: ['code'],
  additionalProperties: false,
  properties: { code: { type: 'string', minLength: 1, maxLength: 2048 } },
} as const;

export interface MediaSearchRoutesDeps {
  mediaSearchService: MediaSearchService;
  requireAuth: preHandlerHookHandler;
}

export function registerMediaSearchRoutes(app: FastifyInstance, deps: MediaSearchRoutesDeps): void {
  const controller = new MediaSearchController(deps.mediaSearchService);
  const auth = { preHandler: deps.requireAuth };

  app.get<{ Querystring: { q: string; source?: string; rating?: 'safe' | 'all' | 'r18' } }>(
    '/api/media-search',
    { ...auth, schema: { querystring: searchQuerySchema } },
    controller.search,
  );
  app.get('/api/media-search/sources', auth, controller.sources);
  // 预览代理公开：<img> 标签带不了 Authorization 头；白名单在 service 内控制
  app.get<{ Querystring: { url: string } }>(
    '/api/media-search/preview',
    { schema: { querystring: previewQuerySchema } },
    controller.preview,
  );
  app.get('/api/media-search/config', auth, controller.getConfig);
  app.patch<{ Body: Partial<MediaSearchConfig> }>(
    '/api/media-search/config',
    { ...auth, schema: { body: configBodySchema } },
    controller.patchConfig,
  );
  app.post('/api/media-search/pixiv/login', auth, controller.pixivLogin);
  app.get('/api/media-search/pixiv/login/status', auth, controller.pixivLoginStatus);
  app.post<{ Body: { code: string } }>(
    '/api/media-search/pixiv/code',
    { ...auth, schema: { body: codeBodySchema } },
    controller.pixivCode,
  );
}
