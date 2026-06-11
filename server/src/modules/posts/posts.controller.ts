import type { CreatePostRequest } from '@socialsim/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { viewerIdOf } from '../../core/auth/auth-guard.js';
import type { PostsService } from './posts.service.js';

interface PageQuery {
  cursor?: string;
  limit?: number;
}

export class PostsController {
  constructor(private readonly service: PostsService) {}

  create = async (req: FastifyRequest<{ Body: CreatePostRequest }>, reply: FastifyReply) => {
    reply.status(201).send({ post: await this.service.create(req.user.sub, req.body) });
  };

  getById = async (req: FastifyRequest<{ Params: { id: number } }>, reply: FastifyReply) => {
    reply.send({ post: this.service.getView(req.params.id, viewerIdOf(req)) });
  };

  listReplies = async (
    req: FastifyRequest<{ Params: { id: number }; Querystring: PageQuery }>,
    reply: FastifyReply,
  ) => {
    reply.send(
      this.service.listReplies(req.params.id, viewerIdOf(req), req.query.cursor, req.query.limit),
    );
  };

  listByHandle = async (
    req: FastifyRequest<{
      Params: { handle: string };
      Querystring: PageQuery & { type?: 'posts' | 'replies' };
    }>,
    reply: FastifyReply,
  ) => {
    reply.send(
      this.service.listByHandle(
        req.params.handle,
        viewerIdOf(req),
        req.query.cursor,
        req.query.limit,
        req.query.type ?? 'posts',
      ),
    );
  };

  listMediaByHandle = async (
    req: FastifyRequest<{ Params: { handle: string }; Querystring: PageQuery }>,
    reply: FastifyReply,
  ) => {
    reply.send(
      this.service.listMediaByHandle(
        req.params.handle,
        viewerIdOf(req),
        req.query.cursor,
        req.query.limit,
      ),
    );
  };

  listLikedByHandle = async (
    req: FastifyRequest<{ Params: { handle: string }; Querystring: PageQuery }>,
    reply: FastifyReply,
  ) => {
    reply.send(
      this.service.listLikedByHandle(
        req.params.handle,
        viewerIdOf(req),
        req.query.cursor,
        req.query.limit,
      ),
    );
  };

  delete = async (req: FastifyRequest<{ Params: { id: number } }>, reply: FastifyReply) => {
    this.service.delete(req.params.id, req.user.sub);
    reply.status(204).send();
  };

  recordViews = async (req: FastifyRequest<{ Body: { ids: number[] } }>, reply: FastifyReply) => {
    this.service.recordViews(req.body.ids);
    reply.status(204).send();
  };

  pin = async (req: FastifyRequest<{ Params: { id: number } }>, reply: FastifyReply) => {
    reply.send(this.service.pin(req.user.sub, req.params.id));
  };

  unpin = async (req: FastifyRequest<{ Params: { id: number } }>, reply: FastifyReply) => {
    reply.send(this.service.unpin(req.user.sub, req.params.id));
  };
}
