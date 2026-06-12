import type { FastifyReply, FastifyRequest } from 'fastify';
import type { MediaSearchService } from './media-search.service.js';
import type { MediaSearchConfig } from './search-config.js';

export class MediaSearchController {
  constructor(private readonly service: MediaSearchService) {}

  search = async (
    req: FastifyRequest<{
      Querystring: { q: string; source?: string; rating?: 'safe' | 'all' | 'r18' };
    }>,
    reply: FastifyReply,
  ) => {
    reply.send({
      results: await this.service.search(req.query.q, req.query.source, req.query.rating),
    });
  };

  sources = async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send({ sources: this.service.sources() });
  };

  preview = async (
    req: FastifyRequest<{ Querystring: { url: string } }>,
    reply: FastifyReply,
  ) => {
    const { buf, contentType } = await this.service.previewProxy(req.query.url);
    return reply
      .header('Content-Type', contentType)
      .header('Cache-Control', 'public, max-age=3600')
      .send(buf);
  };

  getConfig = async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send({ config: this.service.maskedConfig() });
  };

  patchConfig = async (
    req: FastifyRequest<{ Body: Partial<MediaSearchConfig> }>,
    reply: FastifyReply,
  ) => {
    reply.send({ config: this.service.patchConfig(req.body) });
  };

  pixivLogin = async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send(await this.service.pixivLoginStart());
  };

  pixivLoginStatus = async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send(this.service.pixivLoginStatus());
  };

  pixivCode = async (req: FastifyRequest<{ Body: { code: string } }>, reply: FastifyReply) => {
    reply.send(await this.service.pixivSubmitCode(req.body.code));
  };
}
