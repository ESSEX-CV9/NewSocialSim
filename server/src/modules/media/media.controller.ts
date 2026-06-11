import type { FastifyReply, FastifyRequest } from 'fastify';
import { ValidationError } from '../../core/errors/app-error.js';
import type { MediaService } from './media.service.js';

export class MediaController {
  constructor(private readonly service: MediaService) {}

  upload = async (req: FastifyRequest, reply: FastifyReply) => {
    const part = await req.file();
    if (!part) throw new ValidationError('缺少文件');
    const buf = await part.toBuffer();
    const media = this.service.createFromBuffer(req.user.sub, buf, part.mimetype, 'upload');
    reply.status(201).send({ media });
  };

  file = async (
    req: FastifyRequest<{ Params: { id: number }; Querystring: { w: string } }>,
    reply: FastifyReply,
  ) => {
    const { stream, mime, size } = this.service.getFileStream(req.params.id, req.query.w);
    // 必须 return reply：async handler resolve undefined 会与流管道竞争，导致空 body
    return reply
      .header('Content-Type', mime)
      .header('Content-Length', size)
      // 同一 URL（含 ?w=）内容永不变化，可永久缓存
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(stream);
  };
}
