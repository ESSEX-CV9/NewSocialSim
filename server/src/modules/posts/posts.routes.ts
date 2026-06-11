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
  app.get<{ Params: { handle: string }; Querystring: { cursor?: string; limit?: number } }>(
    '/api/users/:handle/posts',
    { preHandler: deps.optionalAuth, schema: { querystring: pageQuerySchema } },
    controller.listByHandle,
  );
  app.delete<{ Params: { id: number } }>(
    '/api/posts/:id',
    { preHandler: deps.requireAuth, schema: { params: idParamsSchema } },
    controller.delete,
  );
}
