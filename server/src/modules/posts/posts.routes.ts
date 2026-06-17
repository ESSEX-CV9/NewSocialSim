import type { CreatePostRequest } from '@socialsim/shared';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { OPTIONAL_JWT, REQUIRE_JWT, envelope, pageOf } from '../../core/openapi/swagger.js';
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
    mediaIds: {
      type: 'array',
      items: { type: 'integer', minimum: 1 },
      // 与 media.service 的 MAX_PER_POST 一致
      maxItems: 20,
      uniqueItems: true,
    },
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
    from: { type: 'integer', description: '只取 created_at ≥ from 的帖（模拟时间 ms，时间轴按窗口取回复）' },
    to: { type: 'integer', description: '只取 created_at ≤ to 的帖（模拟时间 ms）' },
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
    {
      preHandler: deps.requireAuth,
      schema: {
        tags: ['posts'],
        summary: '发帖',
        operationId: 'createPost',
        security: REQUIRE_JWT,
        body: createPostBodySchema,
        response: { 201: envelope('post', 'PostView') },
      },
    },
    controller.create,
  );
  app.get<{ Params: { id: number } }>(
    '/api/posts/:id',
    {
      preHandler: deps.optionalAuth,
      schema: {
        tags: ['posts'],
        summary: '单帖详情（删除返墓碑）',
        operationId: 'getPostById',
        security: OPTIONAL_JWT,
        params: idParamsSchema,
        response: { 200: envelope('post', 'PostView') },
      },
    },
    controller.getById,
  );
  app.get<{ Params: { id: number }; Querystring: { cursor?: string; limit?: number } }>(
    '/api/posts/:id/replies',
    {
      preHandler: deps.optionalAuth,
      schema: {
        tags: ['posts'],
        summary: '某帖的回复',
        operationId: 'listPostReplies',
        security: OPTIONAL_JWT,
        params: idParamsSchema,
        querystring: pageQuerySchema,
        response: { 200: pageOf('PostView') },
      },
    },
    controller.listReplies,
  );
  app.get<{
    Params: { handle: string };
    Querystring: { cursor?: string; limit?: number; type?: 'posts' | 'replies'; from?: number; to?: number };
  }>(
    '/api/users/:handle/posts',
    {
      preHandler: deps.optionalAuth,
      schema: {
        tags: ['posts'],
        summary: '某账号的帖',
        operationId: 'listUserPosts',
        security: OPTIONAL_JWT,
        querystring: userPostsQuerySchema,
        response: { 200: pageOf('PostView') },
      },
    },
    controller.listByHandle,
  );
  app.get<{ Params: { handle: string }; Querystring: { cursor?: string; limit?: number } }>(
    '/api/users/:handle/likes',
    {
      preHandler: deps.optionalAuth,
      schema: {
        tags: ['posts'],
        summary: '某账号点赞过的帖',
        operationId: 'listUserLikes',
        security: OPTIONAL_JWT,
        querystring: pageQuerySchema,
        response: { 200: pageOf('PostView') },
      },
    },
    controller.listLikedByHandle,
  );
  app.get<{ Params: { handle: string }; Querystring: { cursor?: string; limit?: number } }>(
    '/api/users/:handle/media',
    {
      preHandler: deps.optionalAuth,
      schema: {
        tags: ['posts'],
        summary: '某账号的含媒体帖',
        operationId: 'listUserMedia',
        security: OPTIONAL_JWT,
        querystring: pageQuerySchema,
        response: { 200: pageOf('PostView') },
      },
    },
    controller.listMediaByHandle,
  );
  app.delete<{ Params: { id: number } }>(
    '/api/posts/:id',
    {
      preHandler: deps.requireAuth,
      schema: {
        tags: ['posts'],
        summary: '删帖（仅本人）',
        operationId: 'deletePost',
        security: REQUIRE_JWT,
        params: idParamsSchema,
      },
    },
    controller.delete,
  );
  app.post<{ Params: { id: number } }>(
    '/api/posts/:id/pin',
    {
      preHandler: deps.requireAuth,
      schema: {
        tags: ['posts'],
        summary: '置顶',
        operationId: 'pinPost',
        security: REQUIRE_JWT,
        params: idParamsSchema,
      },
    },
    controller.pin,
  );
  app.delete<{ Params: { id: number } }>(
    '/api/posts/:id/pin',
    {
      preHandler: deps.requireAuth,
      schema: {
        tags: ['posts'],
        summary: '取消置顶',
        operationId: 'unpinPost',
        security: REQUIRE_JWT,
        params: idParamsSchema,
      },
    },
    controller.unpin,
  );
  // 曝光上报：匿名也计数（optionalAuth 同时兼容不带 Authorization 头的 sendBeacon）
  app.post<{ Body: { ids: number[] } }>(
    '/api/posts/views',
    {
      preHandler: deps.optionalAuth,
      schema: {
        tags: ['posts'],
        summary: '曝光计数上报',
        operationId: 'recordPostViews',
        security: OPTIONAL_JWT,
        body: recordViewsBodySchema,
      },
    },
    controller.recordViews,
  );
}
