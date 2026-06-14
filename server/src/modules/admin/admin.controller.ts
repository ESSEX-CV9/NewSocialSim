import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AdminService } from './admin.service.js';

export class AdminController {
  constructor(private readonly service: AdminService) {}

  createPost = async (
    req: FastifyRequest<{
      Body: {
        authorId: number;
        content: string;
        createdAt?: number;
        replyToId?: number;
        quoteOfId?: number;
      };
    }>,
    reply: FastifyReply,
  ) => {
    const result = await this.service.createPost(req.body);
    reply.status(201).send(result);
  };

  bulkFollow = async (
    req: FastifyRequest<{
      Body: { pairs: Array<{ followerId: number; followeeId: number }> };
    }>,
    reply: FastifyReply,
  ) => {
    const result = this.service.bulkFollow(req.body.pairs);
    reply.send(result);
  };

  updateCounts = async (
    req: FastifyRequest<{
      Params: { id: string };
      Body: {
        likeCount?: number;
        repostCount?: number;
        replyCount?: number;
        viewCount?: number;
      };
    }>,
    reply: FastifyReply,
  ) => {
    this.service.updateCounts(Number(req.params.id), req.body);
    reply.send({ ok: true });
  };

  simulatorStatus = async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send(this.service.getSimulatorStatus());
  };
}
