import type { FastifyReply, FastifyRequest } from 'fastify';
import type { InteractionsService } from './interactions.service.js';

type Req = FastifyRequest<{ Params: { id: number } }>;

export class InteractionsController {
  constructor(private readonly service: InteractionsService) {}

  like = async (req: Req, reply: FastifyReply) => {
    reply.send(this.service.like(req.user.sub, req.params.id));
  };

  unlike = async (req: Req, reply: FastifyReply) => {
    reply.send(this.service.unlike(req.user.sub, req.params.id));
  };

  repost = async (req: Req, reply: FastifyReply) => {
    reply.send(this.service.repost(req.user.sub, req.params.id));
  };

  unrepost = async (req: Req, reply: FastifyReply) => {
    reply.send(this.service.unrepost(req.user.sub, req.params.id));
  };
}
