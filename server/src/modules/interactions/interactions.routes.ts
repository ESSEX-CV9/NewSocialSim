import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { OPTIONAL_JWT, REQUIRE_JWT, pageOf } from '../../core/openapi/swagger.js';
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
  // 赞/转返回 { active, count }；收藏/隐藏只返回 { active }——response 形态不同，故由调用方传入。
  const interactionResultResponse = {
    type: 'object',
    additionalProperties: true,
    properties: { active: { type: 'boolean' }, count: { type: 'integer' } },
  } as const;
  const activeOnlyResponse = {
    type: 'object',
    additionalProperties: true,
    properties: { active: { type: 'boolean' } },
  } as const;
  const interaction = (
    summary: string,
    operationId: string,
    response: typeof interactionResultResponse | typeof activeOnlyResponse,
  ) => ({
    preHandler: deps.requireAuth,
    schema: {
      tags: ['interactions'],
      summary,
      operationId,
      security: REQUIRE_JWT,
      params: idParamsSchema,
      response: { 200: response },
    },
  });

  app.post<{ Params: { id: number } }>(
    '/api/posts/:id/like',
    interaction('赞', 'likePost', interactionResultResponse),
    controller.like,
  );
  app.delete<{ Params: { id: number } }>(
    '/api/posts/:id/like',
    interaction('取消赞', 'unlikePost', interactionResultResponse),
    controller.unlike,
  );
  app.post<{ Params: { id: number } }>(
    '/api/posts/:id/repost',
    interaction('转', 'repostPost', interactionResultResponse),
    controller.repost,
  );
  app.delete<{ Params: { id: number } }>(
    '/api/posts/:id/repost',
    interaction('取消转', 'unrepostPost', interactionResultResponse),
    controller.unrepost,
  );
  app.post<{ Params: { id: number } }>(
    '/api/posts/:id/bookmark',
    interaction('收藏（私密）', 'bookmarkPost', activeOnlyResponse),
    controller.bookmark,
  );
  app.delete<{ Params: { id: number } }>(
    '/api/posts/:id/bookmark',
    interaction('取消收藏（私密）', 'unbookmarkPost', activeOnlyResponse),
    controller.unbookmark,
  );
  app.post<{ Params: { id: number } }>(
    '/api/posts/:id/hide',
    interaction('隐藏（"不感兴趣"）', 'hidePost', activeOnlyResponse),
    controller.hide,
  );
  app.delete<{ Params: { id: number } }>(
    '/api/posts/:id/hide',
    interaction('取消隐藏（"不感兴趣"）', 'unhidePost', activeOnlyResponse),
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
        response: { 200: pageOf('PostView') },
      },
    },
    controller.listBookmarks,
  );
  // 某账号的互动事件流（赞/转/关注，带时间）——供编辑器时间轴；免鉴权（匿名 viewer）。
  app.get<{ Params: { handle: string }; Querystring: { cursor?: string; limit?: number; from?: number; to?: number } }>(
    '/api/users/:handle/interactions',
    {
      preHandler: deps.optionalAuth,
      schema: {
        tags: ['interactions'],
        summary: '某账号互动事件流（赞/转/关注，带发生时间）',
        operationId: 'listUserInteractions',
        security: OPTIONAL_JWT,
        querystring: interactionsQuerySchema,
        response: { 200: pageOf('InteractionEvent') },
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

const interactionsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cursor: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
    from: { type: 'integer', description: '只取 created_at ≥ from 的互动（模拟时间 ms，时间轴按窗口取数）' },
    to: { type: 'integer', description: '只取 created_at ≤ to 的互动（模拟时间 ms）' },
  },
} as const;
