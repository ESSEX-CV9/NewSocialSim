import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { REQUIRE_JWT } from '../../core/openapi/swagger.js';
import { BlocksController } from './blocks.controller.js';
import type { BlocksService } from './blocks.service.js';

export interface BlocksRoutesDeps {
  blocksService: BlocksService;
  requireAuth: preHandlerHookHandler;
}

export function registerBlocksRoutes(app: FastifyInstance, deps: BlocksRoutesDeps): void {
  const controller = new BlocksController(deps.blocksService);

  app.post<{ Params: { handle: string } }>(
    '/api/users/:handle/block',
    {
      preHandler: deps.requireAuth,
      schema: {
        tags: ['blocks'],
        summary: '屏蔽',
        operationId: 'blockUser',
        security: REQUIRE_JWT,
      },
    },
    controller.block,
  );
  app.delete<{ Params: { handle: string } }>(
    '/api/users/:handle/block',
    {
      preHandler: deps.requireAuth,
      schema: {
        tags: ['blocks'],
        summary: '取消屏蔽',
        operationId: 'unblockUser',
        security: REQUIRE_JWT,
      },
    },
    controller.unblock,
  );
}
