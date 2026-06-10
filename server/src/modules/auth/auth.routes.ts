import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { WorldManager } from '../../core/world/world-manager.js';
import { AuthController } from './auth.controller.js';
import type { AuthService } from './auth.service.js';

const registerBodySchema = {
  type: 'object',
  required: ['handle', 'displayName', 'password'],
  additionalProperties: false,
  properties: {
    handle: { type: 'string' },
    displayName: { type: 'string', maxLength: 50 },
    password: { type: 'string', maxLength: 200 },
  },
} as const;

const loginBodySchema = {
  type: 'object',
  required: ['handle', 'password'],
  additionalProperties: false,
  properties: {
    handle: { type: 'string' },
    password: { type: 'string' },
  },
} as const;

export interface AuthRoutesDeps {
  authService: AuthService;
  worldManager: WorldManager;
  requireAuth: preHandlerHookHandler;
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRoutesDeps): void {
  const controller = new AuthController(deps.authService, deps.worldManager);

  app.post('/api/auth/register', { schema: { body: registerBodySchema } }, controller.register);
  app.post('/api/auth/login', { schema: { body: loginBodySchema } }, controller.login);
  app.get('/api/auth/me', { preHandler: deps.requireAuth }, controller.me);
}
