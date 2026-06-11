import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
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
    { preHandler: deps.requireAuth },
    controller.block,
  );
  app.delete<{ Params: { handle: string } }>(
    '/api/users/:handle/block',
    { preHandler: deps.requireAuth },
    controller.unblock,
  );
}
