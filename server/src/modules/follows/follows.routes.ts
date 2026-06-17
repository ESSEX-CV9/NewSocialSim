import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { REQUIRE_JWT, pageOf } from '../../core/openapi/swagger.js';
import { FollowsController } from './follows.controller.js';
import type { FollowsService } from './follows.service.js';

const pageQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cursor: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
  },
} as const;

export interface FollowsRoutesDeps {
  followsService: FollowsService;
  requireAuth: preHandlerHookHandler;
}

export function registerFollowsRoutes(app: FastifyInstance, deps: FollowsRoutesDeps): void {
  const controller = new FollowsController(deps.followsService);

  app.post<{ Params: { handle: string } }>(
    '/api/users/:handle/follow',
    {
      preHandler: deps.requireAuth,
      schema: {
        tags: ['follows'],
        summary: '关注',
        operationId: 'followUser',
        security: REQUIRE_JWT,
        response: {
          200: {
            type: 'object',
            additionalProperties: true,
            properties: { following: { type: 'boolean' } },
          },
        },
      },
    },
    controller.follow,
  );
  app.delete<{ Params: { handle: string } }>(
    '/api/users/:handle/follow',
    {
      preHandler: deps.requireAuth,
      schema: {
        tags: ['follows'],
        summary: '取关',
        operationId: 'unfollowUser',
        security: REQUIRE_JWT,
        response: {
          200: {
            type: 'object',
            additionalProperties: true,
            properties: { following: { type: 'boolean' } },
          },
        },
      },
    },
    controller.unfollow,
  );
  app.get<{ Params: { handle: string }; Querystring: { cursor?: string; limit?: number } }>(
    '/api/users/:handle/followers',
    {
      schema: {
        tags: ['follows'],
        summary: '粉丝',
        operationId: 'listFollowers',
        querystring: pageQuerySchema,
        response: { 200: pageOf('UserSummary') },
      },
    },
    controller.followers,
  );
  app.get<{ Params: { handle: string }; Querystring: { cursor?: string; limit?: number } }>(
    '/api/users/:handle/following',
    {
      schema: {
        tags: ['follows'],
        summary: '关注列表',
        operationId: 'listFollowing',
        querystring: pageQuerySchema,
        response: { 200: pageOf('UserSummary') },
      },
    },
    controller.following,
  );
}
