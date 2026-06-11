import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FollowsService } from './follows.service.js';

type HandleReq = FastifyRequest<{ Params: { handle: string } }>;
type HandlePageReq = FastifyRequest<{
  Params: { handle: string };
  Querystring: { cursor?: string; limit?: number };
}>;

export class FollowsController {
  constructor(private readonly service: FollowsService) {}

  follow = async (req: HandleReq, reply: FastifyReply) => {
    reply.send(this.service.follow(req.user.sub, req.params.handle));
  };

  unfollow = async (req: HandleReq, reply: FastifyReply) => {
    reply.send(this.service.unfollow(req.user.sub, req.params.handle));
  };

  followers = async (req: HandlePageReq, reply: FastifyReply) => {
    reply.send(this.service.followers(req.params.handle, req.query.cursor, req.query.limit));
  };

  following = async (req: HandlePageReq, reply: FastifyReply) => {
    reply.send(this.service.following(req.params.handle, req.query.cursor, req.query.limit));
  };
}
