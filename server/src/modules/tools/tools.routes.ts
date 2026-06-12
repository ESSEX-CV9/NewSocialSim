import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { ToolsController } from './tools.controller.js';
import type { ToolId, ToolsService } from './tools.service.js';

const toolParamsSchema = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string', enum: ['yt-dlp', 'ffmpeg'] } },
} as const;

export interface ToolsRoutesDeps {
  toolsService: ToolsService;
  requireAuth: preHandlerHookHandler;
}

export function registerToolsRoutes(app: FastifyInstance, deps: ToolsRoutesDeps): void {
  const controller = new ToolsController(deps.toolsService);
  const auth = { preHandler: deps.requireAuth };

  app.get('/api/tools/status', auth, controller.status);
  app.get('/api/tools/latest', auth, controller.latest);
  app.post<{ Params: { id: ToolId } }>(
    '/api/tools/:id/install',
    { ...auth, schema: { params: toolParamsSchema } },
    controller.install,
  );
  app.get<{ Params: { id: ToolId } }>(
    '/api/tools/:id/install/status',
    { ...auth, schema: { params: toolParamsSchema } },
    controller.installStatus,
  );
}
