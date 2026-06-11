import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { NotificationsController } from './notifications.controller.js';
import type { NotificationsService } from './notifications.service.js';

const pageQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cursor: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
    filter: { type: 'string', enum: ['all', 'mentions'] },
  },
} as const;

export interface NotificationsRoutesDeps {
  notificationsService: NotificationsService;
  requireAuth: preHandlerHookHandler;
}

export function registerNotificationsRoutes(
  app: FastifyInstance,
  deps: NotificationsRoutesDeps,
): void {
  const controller = new NotificationsController(deps.notificationsService);

  app.get<{ Querystring: { cursor?: string; limit?: number; filter?: 'all' | 'mentions' } }>(
    '/api/notifications',
    { preHandler: deps.requireAuth, schema: { querystring: pageQuerySchema } },
    controller.list,
  );
  app.get('/api/notifications/unread-count', { preHandler: deps.requireAuth }, controller.unreadCount);
  app.post('/api/notifications/read-all', { preHandler: deps.requireAuth }, controller.markAllRead);
}
