import type { FastifyReply, FastifyRequest } from 'fastify';
import type { BlocksService } from './blocks.service.js';

type HandleReq = FastifyRequest<{ Params: { handle: string } }>;

export class BlocksController {
  constructor(private readonly service: BlocksService) {}

  block = async (req: HandleReq, reply: FastifyReply) => {
    reply.send(this.service.block(req.user.sub, req.params.handle));
  };

  unblock = async (req: HandleReq, reply: FastifyReply) => {
    reply.send(this.service.unblock(req.user.sub, req.params.handle));
  };
}
