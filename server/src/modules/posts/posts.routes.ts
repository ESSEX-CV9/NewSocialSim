import type { CreatePostRequest } from '@socialsim/shared';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { PostsController } from './posts.controller.js';
import type { PostsService } from './posts.service.js';

const createPostBodySchema = {
  type: 'object',
  required: ['content'],
  additionalProperties: false,
  properties: {
    content: { type: 'string', maxLength: 1000 },
    replyToId: { type: 'integer' },
    quoteOfId: { type: 'integer' },
  },
} as const;

const recordViewsBodySchema = {
  type: 'object',
  required: ['ids'],
  additionalProperties: false,
  properties: {
    ids: {
      type: 'array',
      items: { type: 'integer', minimum: 1 },
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
    },
  },
} as const;

const idParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer' } },
} as const;

const pageQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cursor: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
  },
} as const;

const userPostsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cursor: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
    type: { type: 'string', enum: ['posts', 'replies'] },
  },
} as const;

export interface PostsRoutesDeps {
  postsService: PostsService;
  requireAuth: preHandlerHookHandler;
  optionalAuth: preHandlerHookHandler;
}

export function registerPostsRoutes(app: FastifyInstance, deps: PostsRoutesDeps): void {
  const controller = new PostsController(deps.postsService);

  app.post<{ Body: CreatePostRequest }>(
    '/api/posts',
    { preHandler: deps.requireAuth, schema: { body: createPostBodySchema } },
    controller.create,
  );
  app.get<{ Params: { id: number } }>(
    '/api/posts/:id',
    { preHandler: deps.optionalAuth, schema: { params: idParamsSchema } },
    controller.getById,
  );
  app.get<{ Params: { id: number }; Querystring: { cursor?: string; limit?: number } }>(
    '/api/posts/:id/replies',
    { preHandler: deps.optionalAuth, schema: { params: idParamsSchema, querystring: pageQuerySchema } },
    controller.listReplies,
  );
  app.get<{
    Params: { handle: string };
    Querystring: { cursor?: string; limit?: number; type?: 'posts' | 'replies' };
  }>(
    '/api/users/:handle/posts',
    { preHandler: deps.optionalAuth, schema: { querystring: userPostsQuerySchema } },
    controller.listByHandle,
  );
  app.get<{ Params: { handle: string }; Querystring: { cursor?: string; limit?: number } }>(
    '/api/users/:handle/likes',
    { preHandler: deps.optionalAuth, schema: { querystring: pageQuerySchema } },
    controller.listLikedByHandle,
  );
  app.delete<{ Params: { id: number } }>(
    '/api/posts/:id',
    { preHandler: deps.requireAuth, schema: { params: idParamsSchema } },
    controller.delete,
  );
  // 曝光上报：匿名也计数（optionalAuth 同时兼容不带 Authorization 头的 sendBeacon）
  app.post<{ Body: { ids: number[] } }>(
    '/api/posts/views',
    { preHandler: deps.optionalAuth, schema: { body: recordViewsBodySchema } },
    controller.recordViews,
  );
}
