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
  },
} as const;

export interface UsersRoutesDeps {
  usersService: UsersService;
  requireAuth: preHandlerHookHandler;
}

export function registerUsersRoutes(app: FastifyInstance, deps: UsersRoutesDeps): void {
  const controller = new UsersController(deps.usersService);

  app.get('/api/users/:handle', controller.getByHandle);
  app.patch<{ Body: UpdateProfileRequest }>(
    '/api/users/me',
    { preHandler: deps.requireAuth, schema: { body: updateProfileBodySchema } },
    controller.updateMe,
  );
}
