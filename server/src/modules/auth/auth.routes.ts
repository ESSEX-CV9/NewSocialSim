import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { WorldManager } from '../../core/world/world-manager.js';
import { REQUIRE_JWT, envelope, ref } from '../../core/openapi/swagger.js';
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

  app.post(
    '/api/auth/register',
    {
      schema: {
        tags: ['auth'],
        summary: '注册真人账号',
        operationId: 'register',
        body: registerBodySchema,
        response: { 201: ref('AuthResponse') },
      },
    },
    controller.register,
  );
  app.post(
    '/api/auth/login',
    {
      schema: {
        tags: ['auth'],
        summary: '登录',
        operationId: 'login',
        body: loginBodySchema,
        response: { 200: ref('AuthResponse') },
      },
    },
    controller.login,
  );
  app.get(
    '/api/auth/me',
    {
      preHandler: deps.requireAuth,
      schema: {
        tags: ['auth'],
        summary: '当前登录用户',
        operationId: 'getMe',
        security: REQUIRE_JWT,
        response: { 200: envelope('user', 'UserProfile') },
      },
    },
    controller.me,
  );
}
