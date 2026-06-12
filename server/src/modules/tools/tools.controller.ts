import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ToolId, ToolsService } from './tools.service.js';

export class ToolsController {
  constructor(private readonly service: ToolsService) {}

  status = async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send({ tools: await this.service.status() });
  };

  latest = async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send({ latest: await this.service.latestVersions() });
  };

  install = async (req: FastifyRequest<{ Params: { id: ToolId } }>, reply: FastifyReply) => {
    reply.status(202).send({ job: this.service.startInstall(req.params.id) });
  };

  installStatus = async (req: FastifyRequest<{ Params: { id: ToolId } }>, reply: FastifyReply) => {
    reply.send({ job: this.service.installStatus(req.params.id) });
  };
}
