import type { FastifyReply, FastifyRequest } from 'fastify';
import { viewerIdOf } from '../../core/auth/auth-guard.js';
import type { SearchService } from './search.service.js';

type SearchReq = FastifyRequest<{ Querystring: { q: string; cursor?: string; limit?: number } }>;
type TrendsReq = FastifyRequest<{ Querystring: { limit?: number } }>;

export class SearchController {
  constructor(private readonly service: SearchService) {}

  posts = async (req: SearchReq, reply: FastifyReply) => {
    reply.send(this.service.posts(req.query.q, viewerIdOf(req), req.query.cursor, req.query.limit));
  };

  users = async (req: SearchReq, reply: FastifyReply) => {
    reply.send(this.service.users(req.query.q, req.query.cursor, req.query.limit));
  };

  trends = async (req: TrendsReq, reply: FastifyReply) => {
    reply.send({ trends: this.service.trends(req.query.limit) });
  };
}
