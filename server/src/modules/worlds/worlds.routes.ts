import type { FastifyInstance } from 'fastify';
import type { WorldManager } from '../../core/world/world-manager.js';
import { WorldsController } from './worlds.controller.js';
import { WorldsService } from './worlds.service.js';

const TAG = 'worlds';

const createWorldBodySchema = {
  type: 'object',
  required: ['id', 'name'],
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    description: { type: 'string', maxLength: 2000 },
    locale: { type: 'string', enum: ['zh-CN', 'en'] },
    contentRating: { type: 'string', enum: ['safe', 'all'] },
    clock: {
      type: 'object',
      additionalProperties: false,
      properties: {
        simTimeMs: { type: 'integer' },
        scale: { type: 'number' },
        paused: { type: 'boolean' },
      },
    },
    calendar: {
      type: 'object',
      required: ['label'],
      additionalProperties: false,
      properties: {
        label: { type: 'string', minLength: 1, maxLength: 50 },
      },
    },
  },
} as const;

const updateMetaBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    description: { type: 'string', maxLength: 2000 },
    locale: { type: 'string', enum: ['zh-CN', 'en'] },
    contentRating: { type: 'string', enum: ['safe', 'all'] },
    calendar: {
      type: 'object',
      required: ['label'],
      additionalProperties: false,
      properties: { label: { type: 'string', minLength: 1, maxLength: 50 } },
    },
  },
} as const;

const clockControlBodySchema = {
  type: 'object',
  required: ['type'],
  additionalProperties: false,
  properties: {
    type: { type: 'string', enum: ['pause', 'resume', 'setScale', 'setTime'] },
    scale: { type: 'number' },
    simTimeMs: { type: 'integer' },
  },
} as const;

const copyBodySchema = {
  type: 'object',
  required: ['newId'],
  additionalProperties: false,
  properties: { newId: { type: 'string' } },
} as const;

const createSnapshotBodySchema = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: { name: { type: 'string', minLength: 1 }, description: { type: 'string' } },
} as const;

const worldIdParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string' } },
} as const;

const snapshotParamsSchema = {
  type: 'object',
  required: ['id', 'name'],
  properties: { id: { type: 'string' }, name: { type: 'string' } },
} as const;

export interface WorldsRoutesDeps {
  worldManager: WorldManager;
}

// 注：/api/admin/worlds* 当前无 preHandler 鉴权（习惯上仍带 admin-key，但服务端未强制），
// 故 spec 如实不标 security；tag 描述已注明。
export function registerWorldsRoutes(app: FastifyInstance, deps: WorldsRoutesDeps): void {
  const controller = new WorldsController(new WorldsService(deps.worldManager));

  app.get(
    '/api/admin/worlds',
    { schema: { tags: [TAG], summary: '列世界', operationId: 'listWorlds' } },
    controller.list,
  );
  app.post(
    '/api/admin/worlds',
    { schema: { tags: [TAG], summary: '创建世界', operationId: 'createWorld', body: createWorldBodySchema } },
    controller.create,
  );
  app.post(
    '/api/admin/worlds/:id/activate',
    { schema: { tags: [TAG], summary: '激活（切换）世界', operationId: 'activateWorld', params: worldIdParamsSchema } },
    controller.activate,
  );
  app.get(
    '/api/admin/worlds/active',
    { schema: { tags: [TAG], summary: '活动世界 + 当前模拟时间', operationId: 'getActiveWorld' } },
    controller.active,
  );
  app.patch(
    '/api/admin/worlds/:id',
    {
      schema: {
        tags: [TAG],
        summary: '改世界元数据',
        operationId: 'updateWorldMeta',
        params: worldIdParamsSchema,
        body: updateMetaBodySchema,
      },
    },
    controller.updateMeta,
  );
  app.post(
    '/api/admin/worlds/clock',
    {
      schema: {
        tags: [TAG],
        summary: '时钟控制（暂停/恢复/调速/跳转）',
        operationId: 'controlWorldClock',
        body: clockControlBodySchema,
      },
    },
    controller.clockControl,
  );
  app.post<{ Params: { id: string }; Body: { newId: string } }>(
    '/api/admin/worlds/:id/copy',
    {
      schema: {
        tags: [TAG],
        summary: '复制世界',
        operationId: 'copyWorld',
        params: worldIdParamsSchema,
        body: copyBodySchema,
      },
    },
    controller.copyWorld,
  );
  app.post<{ Body: { name: string; description?: string } }>(
    '/api/admin/worlds/snapshots',
    {
      schema: {
        tags: [TAG],
        summary: '对活动世界建快照',
        operationId: 'createWorldSnapshot',
        body: createSnapshotBodySchema,
      },
    },
    controller.createSnapshot,
  );
  app.get<{ Params: { id: string } }>(
    '/api/admin/worlds/:id/snapshots',
    { schema: { tags: [TAG], summary: '列快照', operationId: 'listWorldSnapshots', params: worldIdParamsSchema } },
    controller.listSnapshots,
  );
  app.post<{ Params: { id: string; name: string } }>(
    '/api/admin/worlds/:id/snapshots/:name/restore',
    {
      schema: {
        tags: [TAG],
        summary: '恢复快照',
        operationId: 'restoreWorldSnapshot',
        params: snapshotParamsSchema,
      },
    },
    controller.restoreSnapshot,
  );
  app.delete<{ Params: { id: string; name: string } }>(
    '/api/admin/worlds/:id/snapshots/:name',
    {
      schema: {
        tags: [TAG],
        summary: '删快照',
        operationId: 'deleteWorldSnapshot',
        params: snapshotParamsSchema,
      },
    },
    controller.removeSnapshot,
  );
  app.delete(
    '/api/admin/worlds/:id',
    { schema: { tags: [TAG], summary: '删除世界', operationId: 'deleteWorld', params: worldIdParamsSchema } },
    controller.deleteWorld,
  );
}
