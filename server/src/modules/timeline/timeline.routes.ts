import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { TimelineController } from './timeline.controller.js';
import type { HomeSort, TimelineService } from './timeline.service.js';

const pageQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cursor: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
  },
} as const;

const homeQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cursor: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
    sort: { type: 'string', enum: ['latest', 'hot'] },
  },
} as const;

export interface TimelineRoutesDeps {
  timelineService: TimelineService;
  requireAuth: preHandlerHookHandler;
  optionalAuth: preHandlerHookHandler;
}

export function registerTimelineRoutes(app: FastifyInstance, deps: TimelineRoutesDeps): void {
  const controller = new TimelineController(deps.timelineService);

  app.get<{ Querystring: { cursor?: string; limit?: number; sort?: HomeSort } }>(
    '/api/timeline/home',
    { preHandler: deps.requireAuth, schema: { querystring: homeQuerySchema } },
    controller.home,
  );
  app.get<{ Querystring: { cursor?: string; limit?: number } }>(
    '/api/timeline/foryou',
    { preHandler: deps.optionalAuth, schema: { querystring: pageQuerySchema } },
    controller.forYou,
  );
  app.get<{ Querystring: { cursor?: string; limit?: number } }>(
    '/api/timeline/global',
    { preHandler: deps.optionalAuth, schema: { querystring: pageQuerySchema } },
    controller.global,
  );
  app.get<{ Params: { handle: string }; Querystring: { cursor?: string; limit?: number } }>(
    '/api/users/:handle/timeline',
    { preHandler: deps.optionalAuth, schema: { querystring: pageQuerySchema } },
    controller.user,
  );
}
