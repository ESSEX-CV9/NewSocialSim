import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { InteractionsController } from './interactions.controller.js';
import type { InteractionsService } from './interactions.service.js';

const idParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer' } },
} as const;

export interface InteractionsRoutesDeps {
  interactionsService: InteractionsService;
  requireAuth: preHandlerHookHandler;
}

export function registerInteractionsRoutes(
  app: FastifyInstance,
  deps: InteractionsRoutesDeps,
): void {
  const controller = new InteractionsController(deps.interactionsService);
  const opts = { preHandler: deps.requireAuth, schema: { params: idParamsSchema } };

  app.post<{ Params: { id: number } }>('/api/posts/:id/like', opts, controller.like);
  app.delete<{ Params: { id: number } }>('/api/posts/:id/like', opts, controller.unlike);
  app.post<{ Params: { id: number } }>('/api/posts/:id/repost', opts, controller.repost);
  app.delete<{ Params: { id: number } }>('/api/posts/:id/repost', opts, controller.unrepost);
  app.post<{ Params: { id: number } }>('/api/posts/:id/bookmark', opts, controller.bookmark);
  app.delete<{ Params: { id: number } }>('/api/posts/:id/bookmark', opts, controller.unbookmark);
  app.get<{ Querystring: { cursor?: string; limit?: number } }>(
    '/api/bookmarks',
    { preHandler: deps.requireAuth, schema: { querystring: bookmarksQuerySchema } },
    controller.listBookmarks,
  );
}

const bookmarksQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cursor: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
  },
} as const;
