import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { REQUIRE_JWT } from '../../core/openapi/swagger.js';
import { MediaController } from './media.controller.js';
import type { MediaService } from './media.service.js';

const fileParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer' } },
} as const;

const fileQuerySchema = {
  type: 'object',
  required: ['w'],
  additionalProperties: false,
  properties: { w: { type: 'string', minLength: 1 } },
} as const;

export interface MediaRoutesDeps {
  mediaService: MediaService;
  requireAuth: preHandlerHookHandler;
}

const fromUrlBodySchema = {
  type: 'object',
  required: ['url'],
  additionalProperties: false,
  properties: {
    url: { type: 'string', minLength: 1, maxLength: 2048 },
    source: { type: 'string', maxLength: 50 },
  },
} as const;

export function registerMediaRoutes(app: FastifyInstance, deps: MediaRoutesDeps): void {
  const controller = new MediaController(deps.mediaService);

  app.post(
    '/api/media/upload',
    {
      preHandler: deps.requireAuth,
      schema: {
        tags: ['media'],
        summary: '上传文件',
        operationId: 'uploadMedia',
        security: REQUIRE_JWT,
      },
    },
    controller.upload,
  );
  app.post<{ Body: { url: string; source?: string } }>(
    '/api/media/from-url',
    {
      preHandler: deps.requireAuth,
      schema: {
        tags: ['media'],
        summary: '外链下载入库',
        operationId: 'importMediaFromUrl',
        security: REQUIRE_JWT,
        body: fromUrlBodySchema,
      },
    },
    controller.fromUrl,
  );
  // 公开：<img>/<video> 标签无法携带 Authorization 头
  app.get<{ Params: { id: number }; Querystring: { w: string } }>(
    '/api/media/:id/file',
    {
      schema: {
        tags: ['media'],
        summary: '媒体文件流',
        operationId: 'getMediaFile',
        params: fileParamsSchema,
        querystring: fileQuerySchema,
      },
    },
    controller.file,
  );
}
