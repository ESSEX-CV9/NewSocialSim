import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { REQUIRE_JWT } from '../../core/openapi/swagger.js';
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
    {
      preHandler: deps.requireAuth,
      schema: {
        tags: ['notifications'],
        summary: '通知列表',
        operationId: 'listNotifications',
        security: REQUIRE_JWT,
        querystring: pageQuerySchema,
      },
    },
    controller.list,
  );
  app.get(
    '/api/notifications/unread-count',
    {
      preHandler: deps.requireAuth,
      schema: {
        tags: ['notifications'],
        summary: '通知未读数',
        operationId: 'getNotificationsUnreadCount',
        security: REQUIRE_JWT,
      },
    },
    controller.unreadCount,
  );
  app.post(
    '/api/notifications/read-all',
    {
      preHandler: deps.requireAuth,
      schema: {
        tags: ['notifications'],
        summary: '全部已读',
        operationId: 'markAllNotificationsRead',
        security: REQUIRE_JWT,
      },
    },
    controller.markAllRead,
  );
  app.post<{ Body: { ids: number[] } }>(
    '/api/notifications/read',
    {
      preHandler: deps.requireAuth,
      schema: {
        tags: ['notifications'],
        summary: '标部分已读',
        operationId: 'markNotificationsRead',
        security: REQUIRE_JWT,
        body: markReadBodySchema,
      },
    },
    controller.markRead,
  );
}

const markReadBodySchema = {
  type: 'object',
  required: ['ids'],
  additionalProperties: false,
  properties: {
    ids: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 100 },
  },
} as const;
