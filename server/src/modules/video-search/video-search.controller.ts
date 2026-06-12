import type { FastifyReply, FastifyRequest } from 'fastify';
import type { IngestMode, VideoSearchService } from './video-search.service.js';

export class VideoSearchController {
  constructor(private readonly service: VideoSearchService) {}

  ingest = async (
    req: FastifyRequest<{ Body: { url: string; mode?: IngestMode } }>,
    reply: FastifyReply,
  ) => {
    const result = this.service.ingest(req.user.sub, req.body.url, req.body.mode ?? 'auto');
    // 命中嵌入卡时无任务产生（200）；其余创建异步任务（202）
    reply.status(result.embed ? 200 : 202).send(result);
  };

  tasks = async (req: FastifyRequest, reply: FastifyReply) => {
    reply.send({ tasks: this.service.tasks.listForUser(req.user.sub) });
  };

  task = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    reply.send({ task: this.service.tasks.get(req.user.sub, req.params.id) });
  };

  cancel = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    reply.send({ task: this.service.tasks.cancel(req.user.sub, req.params.id) });
  };
}
