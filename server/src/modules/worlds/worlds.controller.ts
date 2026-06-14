import type { FastifyReply, FastifyRequest } from 'fastify';
import type { WorldMeta } from '@socialsim/shared';
import type { CreateWorldInput } from '../../core/world/world-manager.js';
import type { WorldsService } from './worlds.service.js';

export class WorldsController {
  constructor(private readonly service: WorldsService) {}

  list = async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send({ worlds: this.service.list() });
  };

  create = async (req: FastifyRequest<{ Body: CreateWorldInput }>, reply: FastifyReply) => {
    const meta = this.service.create(req.body);
    reply.status(201).send({ world: meta });
  };

  activate = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    reply.send(this.service.activate(req.params.id));
  };

  active = async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send(this.service.active());
  };

  updateMeta = async (
    req: FastifyRequest<{
      Params: { id: string };
      Body: {
        name?: string;
        description?: string;
        locale?: WorldMeta['locale'];
        contentRating?: WorldMeta['contentRating'];
        calendar?: { label: string };
      };
    }>,
    reply: FastifyReply,
  ) => {
    const meta = this.service.updateMeta(req.params.id, req.body);
    reply.send({ world: meta });
  };

  clockControl = async (
    req: FastifyRequest<{
      Body: { type: string; scale?: number; simTimeMs?: number };
    }>,
    reply: FastifyReply,
  ) => {
    const { type, scale, simTimeMs } = req.body;
    let action: Parameters<WorldsService['clockControl']>[0];
    switch (type) {
      case 'pause': action = { type: 'pause' }; break;
      case 'resume': action = { type: 'resume' }; break;
      case 'setScale': action = { type: 'setScale', scale: scale! }; break;
      case 'setTime': action = { type: 'setTime', simTimeMs: simTimeMs! }; break;
      default: return reply.status(400).send({ error: { code: 'VALIDATION', message: `Unknown action: ${type}` } });
    }
    const clock = this.service.clockControl(action);
    reply.send({ clock });
  };

  copyWorld = async (
    req: FastifyRequest<{ Params: { id: string }; Body: { newId: string } }>,
    reply: FastifyReply,
  ) => {
    const meta = this.service.copyWorld(req.params.id, req.body.newId);
    reply.status(201).send({ world: meta });
  };

  createSnapshot = async (
    req: FastifyRequest<{ Body: { name: string; description?: string } }>,
    reply: FastifyReply,
  ) => {
    const info = this.service.createSnapshot(req.body.name, req.body.description);
    reply.status(201).send(info);
  };

  listSnapshots = async (
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    reply.send({ snapshots: this.service.listSnapshots(req.params.id) });
  };

  restoreSnapshot = async (
    req: FastifyRequest<{ Params: { id: string; name: string } }>,
    reply: FastifyReply,
  ) => {
    this.service.restoreSnapshot(req.params.name);
    reply.send({ ok: true });
  };

  removeSnapshot = async (
    req: FastifyRequest<{ Params: { id: string; name: string } }>,
    reply: FastifyReply,
  ) => {
    this.service.removeSnapshot(req.params.id, req.params.name);
    reply.status(204).send();
  };

  deleteWorld = async (
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    this.service.deleteWorld(req.params.id);
    reply.status(204).send();
  };
}
