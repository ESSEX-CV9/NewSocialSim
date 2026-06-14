import type { FastifyInstance } from 'fastify';
import type { WorldManager } from '../../core/world/world-manager.js';
import { WorldsController } from './worlds.controller.js';
import { WorldsService } from './worlds.service.js';

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

export interface WorldsRoutesDeps {
  worldManager: WorldManager;
}

export function registerWorldsRoutes(app: FastifyInstance, deps: WorldsRoutesDeps): void {
  const controller = new WorldsController(new WorldsService(deps.worldManager));

  app.get('/api/admin/worlds', controller.list);
  app.post('/api/admin/worlds', { schema: { body: createWorldBodySchema } }, controller.create);
  app.post('/api/admin/worlds/:id/activate', controller.activate);
  app.get('/api/admin/worlds/active', controller.active);
  app.patch('/api/admin/worlds/:id', controller.updateMeta);
  app.post('/api/admin/worlds/clock', controller.clockControl);
  app.post<{ Params: { id: string }; Body: { newId: string } }>('/api/admin/worlds/:id/copy', controller.copyWorld);
  app.post<{ Body: { name: string; description?: string } }>('/api/admin/worlds/snapshots', controller.createSnapshot);
  app.get<{ Params: { id: string } }>('/api/admin/worlds/:id/snapshots', controller.listSnapshots);
  app.post<{ Params: { id: string; name: string } }>('/api/admin/worlds/:id/snapshots/:name/restore', controller.restoreSnapshot);
  app.delete<{ Params: { id: string; name: string } }>('/api/admin/worlds/:id/snapshots/:name', controller.removeSnapshot);
  app.delete('/api/admin/worlds/:id', controller.deleteWorld);
}
