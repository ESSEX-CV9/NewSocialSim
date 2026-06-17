import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { OPTIONAL_JWT, REQUIRE_JWT } from '../../core/openapi/swagger.js';
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
  optionalAuth: preHandlerHookHandler;
}

export function registerInteractionsRoutes(
  app: FastifyInstance,
  deps: InteractionsRoutesDeps,
): void {
  const controller = new InteractionsController(deps.interactionsService);
  const interaction = (summary: string, operationId: string) => ({
    preHandler: deps.requireAuth,
    schema: {
      tags: ['interactions'],
      summary,
      operationId,
      security: REQUIRE_JWT,
      params: idParamsSchema,
    },
  });

  app.post<{ Params: { id: number } }>(
    '/api/posts/:id/like',
    interaction('赞', 'likePost'),
    controller.like,
  );
  app.delete<{ Params: { id: number } }>(
    '/api/posts/:id/like',
    interaction('取消赞', 'unlikePost'),
    controller.unlike,
  );
  app.post<{ Params: { id: number } }>(
    '/api/posts/:id/repost',
    interaction('转', 'repostPost'),
    controller.repost,
  );
  app.delete<{ Params: { id: number } }>(
    '/api/posts/:id/repost',
    interaction('取消转', 'unrepostPost'),
    controller.unrepost,
  );
  app.post<{ Params: { id: number } }>(
    '/api/posts/:id/bookmark',
    interaction('收藏（私密）', 'bookmarkPost'),
    controller.bookmark,
  );
  app.delete<{ Params: { id: number } }>(
    '/api/posts/:id/bookmark',
    interaction('取消收藏（私密）', 'unbookmarkPost'),
    controller.unbookmark,
  );
  app.post<{ Params: { id: number } }>(
    '/api/posts/:id/hide',
    interaction('隐藏（"不感兴趣"）', 'hidePost'),
    controller.hide,
  );
  app.delete<{ Params: { id: number } }>(
    '/api/posts/:id/hide',
    interaction('取消隐藏（"不感兴趣"）', 'unhidePost'),
    controller.unhide,
  );
  app.get<{ Querystring: { cursor?: string; limit?: number } }>(
    '/api/bookmarks',
    {
      preHandler: deps.requireAuth,
      schema: {
        tags: ['interactions'],
        summary: '本人收藏',
        operationId: 'listBookmarks',
        security: REQUIRE_JWT,
        querystring: bookmarksQuerySchema,
      },
    },
    controller.listBookmarks,
  );
  // 某账号的互动事件流（赞/转/关注，带时间）——供编辑器时间轴；免鉴权（匿名 viewer）。
  app.get<{ Params: { handle: string }; Querystring: { cursor?: string; limit?: number } }>(
    '/api/users/:handle/interactions',
    {
      preHandler: deps.optionalAuth,
      schema: {
        tags: ['interactions'],
        summary: '某账号互动事件流（赞/转/关注，带发生时间）',
        operationId: 'listUserInteractions',
        security: OPTIONAL_JWT,
        querystring: bookmarksQuerySchema,
      },
    },
    controller.listUserInteractions,
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
