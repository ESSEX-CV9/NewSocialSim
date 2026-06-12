import type { FastifyReply, FastifyRequest } from 'fastify';
import { request as undiciRequest, type Dispatcher } from 'undici';
import { AppError } from '../../core/errors/app-error.js';
import { assertPublicHttpUrl } from '../../core/safe-fetch.js';
import type { ResolvedStream } from './stream-resolver.js';
import type { IngestMode, VideoSearchService } from './video-search.service.js';

const MAX_REDIRECT_HOPS = 3;
/** 上游可重试状态码：直链过期/被源站拒绝时失效缓存重解析一次 */
const RETRYABLE_UPSTREAM = [401, 403, 404, 410];

/**
 * 请求上游直链（手动跟随重定向，每跳重做 SSRF 校验）。
 * bodyTimeout 置 0：浏览器暂停播放会令字节流长时间空闲，不能按空闲杀连接。
 */
async function fetchUpstream(
  target: ResolvedStream,
  range: string | undefined,
): Promise<Dispatcher.ResponseData> {
  let url = target.directUrl;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    assertPublicHttpUrl(url);
    const res = await undiciRequest(url, {
      headers: { ...target.httpHeaders, ...(range ? { range } : {}) },
      headersTimeout: 20_000,
      bodyTimeout: 0,
    });
    if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
      const loc = res.headers['location'];
      await res.body.dump();
      const location = Array.isArray(loc) ? loc[0] : loc;
      if (!location) throw new AppError(410, 'STREAM_GONE', '源站重定向缺少落点');
      url = new URL(location, url).href;
      continue;
    }
    return res;
  }
  throw new AppError(410, 'STREAM_GONE', '源站重定向过多');
}

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

  /**
   * 流式引用视频的播放代理（公开，video 标签带不了 JWT）：
   * 解直链（缓存）→ Range 透传 → 字节流管回；上游拒绝时重解析一次再失败。
   */
  stream = async (
    req: FastifyRequest<{ Params: { id: string }; Querystring: { w: string } }>,
    reply: FastifyReply,
  ) => {
    const id = Number(req.params.id);
    const range = req.headers.range;

    let target = await this.service.streamTarget(id, req.query.w);
    let upstream = await fetchUpstream(target, range);
    if (RETRYABLE_UPSTREAM.includes(upstream.statusCode)) {
      await upstream.body.dump();
      this.service.invalidateStream(id);
      target = await this.service.streamTarget(id, req.query.w);
      upstream = await fetchUpstream(target, range);
    }
    if (upstream.statusCode !== 200 && upstream.statusCode !== 206) {
      await upstream.body.dump();
      throw new AppError(410, 'STREAM_GONE', `源站返回 ${upstream.statusCode}`);
    }

    reply.status(upstream.statusCode);
    reply.header('Content-Type', String(upstream.headers['content-type'] ?? 'video/mp4'));
    for (const name of ['content-length', 'content-range', 'accept-ranges'] as const) {
      const v = upstream.headers[name];
      if (v) reply.header(name, Array.isArray(v) ? v[0]! : v);
    }
    // 直链会过期，禁止浏览器缓存代理响应
    reply.header('Cache-Control', 'no-store');
    // 客户端断开（关页/拖进度条放弃旧请求）时立刻掐断上游，不空耗带宽
    req.raw.on('close', () => upstream.body.destroy());
    return reply.send(upstream.body);
  };
}
