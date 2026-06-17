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

  bookmark = async (req: Req, reply: FastifyReply) => {
    reply.send(this.service.bookmark(req.user.sub, req.params.id));
  };

  unbookmark = async (req: Req, reply: FastifyReply) => {
    reply.send(this.service.unbookmark(req.user.sub, req.params.id));
  };

  hide = async (req: Req, reply: FastifyReply) => {
    reply.send(this.service.hide(req.user.sub, req.params.id));
  };

  unhide = async (req: Req, reply: FastifyReply) => {
    reply.send(this.service.unhide(req.user.sub, req.params.id));
  };

  listBookmarks = async (
    req: FastifyRequest<{ Querystring: { cursor?: string; limit?: number } }>,
    reply: FastifyReply,
  ) => {
    reply.send(this.service.listBookmarks(req.user.sub, req.query.cursor, req.query.limit));
  };

  listUserInteractions = async (
    req: FastifyRequest<{
      Params: { handle: string };
      Querystring: { cursor?: string; limit?: number; from?: number; to?: number };
    }>,
    reply: FastifyReply,
  ) => {
    const { cursor, limit, from, to } = req.query;
    reply.send(this.service.listUserActivity(req.params.handle, req.user?.sub ?? null, cursor, limit, { from, to }));
  };
}
