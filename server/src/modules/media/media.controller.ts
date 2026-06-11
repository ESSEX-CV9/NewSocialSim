import fs from 'node:fs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ValidationError } from '../../core/errors/app-error.js';
import { isVideoMime, type MediaService } from './media.service.js';

/** 解析 "bytes=a-b" 请求头；不合法返回 null（按整文件响应） */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    // bytes=-N：末尾 N 字节
    const suffix = Number(m[2]);
    if (suffix === 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return null;
  return { start, end };
}

export class MediaController {
  constructor(private readonly service: MediaService) {}

  upload = async (req: FastifyRequest, reply: FastifyReply) => {
    const part = await req.file();
    if (!part) throw new ValidationError('缺少文件');
    if (isVideoMime(part.mimetype)) {
      // 视频流式落盘，不进内存
      const media = await this.service.createVideoFromStream(req.user.sub, part.file, part.mimetype);
      return reply.status(201).send({ media });
    }
    const buf = await part.toBuffer();
    const media = this.service.createFromBuffer(req.user.sub, buf, part.mimetype, 'upload');
    return reply.status(201).send({ media });
  };

  file = async (
    req: FastifyRequest<{ Params: { id: number }; Querystring: { w: string } }>,
    reply: FastifyReply,
  ) => {
    const { filePath, mime, size } = this.service.getFileInfo(req.params.id, req.query.w);
    const range = parseRange(req.headers.range, size);

    reply
      .header('Content-Type', mime)
      .header('Accept-Ranges', 'bytes')
      // 同一 URL（含 ?w=）内容永不变化，可永久缓存
      .header('Cache-Control', 'public, max-age=31536000, immutable');

    // 必须 return reply：async handler resolve undefined 会与流管道竞争，导致空 body
    if (range) {
      return reply
        .status(206)
        .header('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
        .header('Content-Length', range.end - range.start + 1)
        .send(fs.createReadStream(filePath, { start: range.start, end: range.end }));
    }
    return reply
      .header('Content-Length', size)
      .send(fs.createReadStream(filePath));
  };
}
