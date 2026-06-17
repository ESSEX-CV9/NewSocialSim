import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { REQUIRE_JWT } from '../../core/openapi/swagger.js';
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

  app.get(
    '/api/tools/status',
    {
      ...auth,
      schema: {
        tags: ['tools'],
        summary: '安装状态',
        operationId: 'getToolsStatus',
        security: REQUIRE_JWT,
      },
    },
    controller.status,
  );
  app.get(
    '/api/tools/latest',
    {
      ...auth,
      schema: {
        tags: ['tools'],
        summary: '最新版本',
        operationId: 'getLatestToolVersions',
        security: REQUIRE_JWT,
      },
    },
    controller.latest,
  );
  app.post<{ Params: { id: ToolId } }>(
    '/api/tools/:id/install',
    {
      ...auth,
      schema: {
        tags: ['tools'],
        summary: '安装工具',
        operationId: 'installTool',
        security: REQUIRE_JWT,
        params: toolParamsSchema,
      },
    },
    controller.install,
  );
  app.get<{ Params: { id: ToolId } }>(
    '/api/tools/:id/install/status',
    {
      ...auth,
      schema: {
        tags: ['tools'],
        summary: '安装进度',
        operationId: 'getToolInstallStatus',
        security: REQUIRE_JWT,
        params: toolParamsSchema,
      },
    },
    controller.installStatus,
  );
}
