import type { FastifyReply, FastifyRequest } from 'fastify';
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
}
