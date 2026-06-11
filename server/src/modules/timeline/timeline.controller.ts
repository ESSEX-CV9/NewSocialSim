import type { FastifyReply, FastifyRequest } from 'fastify';
import { viewerIdOf } from '../../core/auth/auth-guard.js';
import type { HomeSort, TimelineService } from './timeline.service.js';

type PageReq = FastifyRequest<{ Querystring: { cursor?: string; limit?: number } }>;

export class TimelineController {
  constructor(private readonly service: TimelineService) {}

  home = async (
    req: FastifyRequest<{ Querystring: { cursor?: string; limit?: number; sort?: HomeSort } }>,
    reply: FastifyReply,
  ) => {
    reply.send(
      this.service.home(req.user.sub, req.query.sort ?? 'latest', req.query.cursor, req.query.limit),
    );
  };

  forYou = async (req: PageReq, reply: FastifyReply) => {
    reply.send(this.service.forYou(viewerIdOf(req), req.query.cursor, req.query.limit));
  };

  global = async (req: PageReq, reply: FastifyReply) => {
    reply.send(this.service.global(viewerIdOf(req), req.query.cursor, req.query.limit));
  };

  user = async (
    req: FastifyRequest<{ Params: { handle: string }; Querystring: { cursor?: string; limit?: number } }>,
    reply: FastifyReply,
  ) => {
    reply.send(this.service.user(req.params.handle, viewerIdOf(req), req.query.cursor, req.query.limit));
  };
}
