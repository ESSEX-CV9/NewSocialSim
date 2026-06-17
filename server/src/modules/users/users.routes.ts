import type { UpdateProfileRequest } from '@socialsim/shared';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { OPTIONAL_JWT, REQUIRE_JWT } from '../../core/openapi/swagger.js';
import { UsersController } from './users.controller.js';
import type { UsersService } from './users.service.js';

const updateProfileBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    displayName: { type: 'string', maxLength: 50 },
    bio: { type: 'string', maxLength: 500 },
    avatarMediaId: { type: ['integer', 'null'] },
    bannerMediaId: { type: ['integer', 'null'] },
    verified: { type: 'string', enum: ['none', 'personal', 'org'] },
    website: { type: ['string', 'null'], maxLength: 200 },
    location: { type: ['string', 'null'], maxLength: 50 },
    birthDate: { type: ['string', 'null'], maxLength: 10 },
    profession: { type: ['string', 'null'], maxLength: 50 },
  },
} as const;

export interface UsersRoutesDeps {
  usersService: UsersService;
  requireAuth: preHandlerHookHandler;
  optionalAuth: preHandlerHookHandler;
}

export function registerUsersRoutes(app: FastifyInstance, deps: UsersRoutesDeps): void {
  const controller = new UsersController(deps.usersService);

  app.get(
    '/api/users/suggested',
    {
      preHandler: deps.optionalAuth,
      schema: {
        tags: ['users'],
        summary: '推荐关注',
        operationId: 'listSuggestedUsers',
        security: OPTIONAL_JWT,
      },
    },
    controller.suggested,
  );
  app.get<{ Params: { handle: string } }>(
    '/api/users/:handle',
    {
      preHandler: deps.optionalAuth,
      schema: {
        tags: ['users'],
        summary: '账号资料',
        operationId: 'getUserProfile',
        security: OPTIONAL_JWT,
      },
    },
    controller.getByHandle,
  );
  app.patch<{ Body: UpdateProfileRequest }>(
    '/api/users/me',
    {
      preHandler: deps.requireAuth,
      schema: {
        tags: ['users'],
        summary: '改本人资料',
        operationId: 'updateMyProfile',
        security: REQUIRE_JWT,
        body: updateProfileBodySchema,
      },
    },
    controller.updateMe,
  );
}
