import type { UpdateProfileRequest } from '@socialsim/shared';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
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
  },
} as const;

export interface UsersRoutesDeps {
  usersService: UsersService;
  requireAuth: preHandlerHookHandler;
  optionalAuth: preHandlerHookHandler;
}

export function registerUsersRoutes(app: FastifyInstance, deps: UsersRoutesDeps): void {
  const controller = new UsersController(deps.usersService);

  app.get('/api/users/suggested', { preHandler: deps.optionalAuth }, controller.suggested);
  app.get<{ Params: { handle: string } }>(
    '/api/users/:handle',
    { preHandler: deps.optionalAuth },
    controller.getByHandle,
  );
  app.patch<{ Body: UpdateProfileRequest }>(
    '/api/users/me',
    { preHandler: deps.requireAuth, schema: { body: updateProfileBodySchema } },
    controller.updateMe,
  );
}
