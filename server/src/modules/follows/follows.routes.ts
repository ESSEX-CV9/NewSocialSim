import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
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
    { preHandler: deps.requireAuth },
    controller.follow,
  );
  app.delete<{ Params: { handle: string } }>(
    '/api/users/:handle/follow',
    { preHandler: deps.requireAuth },
    controller.unfollow,
  );
  app.get<{ Params: { handle: string }; Querystring: { cursor?: string; limit?: number } }>(
    '/api/users/:handle/followers',
    { schema: { querystring: pageQuerySchema } },
    controller.followers,
  );
  app.get<{ Params: { handle: string }; Querystring: { cursor?: string; limit?: number } }>(
    '/api/users/:handle/following',
    { schema: { querystring: pageQuerySchema } },
    controller.following,
  );
}
