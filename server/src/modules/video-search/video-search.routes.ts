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
}
