import type { ProgressiveFormat, YtDlp } from './ytdlp.js';

/**
 * 流式引用的直链解析缓存：mediaId → 渐进式 mp4 直链 + 防盗链请求头。
 * 直链是源站签名的临时地址，过期重解析——这正是"每次播放都新鲜"的机制。
 * TTL 用真实墙钟（Date.now）：直链有效期由外部源站决定，与模拟时间无关。
 */

export interface ResolvedStream {
  directUrl: string;
  httpHeaders: Record<string, string>;
  expiresAt: number;
}

const STREAM_TTL_MS = 4 * 3600 * 1000;

/** 直链有效期：取 TTL 与 URL 自带 expire 参数（unix 秒，YouTube 等）的较早者，留 60 秒余量 */
function expiryOf(directUrl: string): number {
  const cap = Date.now() + STREAM_TTL_MS;
  try {
    const e = Number(new URL(directUrl).searchParams.get('expire'));
    if (Number.isFinite(e) && e > 0) return Math.min(cap, e * 1000 - 60_000);
  } catch {
    // URL 异常时用默认 TTL
  }
  return cap;
}

export class StreamResolver {
  private readonly cache = new Map<number, ResolvedStream>();
  private readonly inflight = new Map<number, Promise<ResolvedStream>>();

  constructor(
    private readonly ytdlp: YtDlp,
    private readonly getProxy: () => string | undefined,
  ) {}

  /** 引入任务 probe 时顺手预热，首次播放免一次解析 */
  prime(mediaId: number, prog: ProgressiveFormat): void {
    this.cache.set(mediaId, {
      directUrl: prog.url,
      httpHeaders: prog.httpHeaders,
      expiresAt: expiryOf(prog.url),
    });
  }

  /** 取直链：缓存未过期直接回；并发同 id 共享同一次解析 */
  resolve(mediaId: number, originUrl: string): Promise<ResolvedStream> {
    const hit = this.cache.get(mediaId);
    if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit);
    const flying = this.inflight.get(mediaId);
    if (flying) return flying;

    const p = this.ytdlp
      .probe(originUrl, this.getProxy())
      .then((probe) => {
        if (!probe.progressive) throw new Error('源站已无渐进式格式');
        const resolved: ResolvedStream = {
          directUrl: probe.progressive.url,
          httpHeaders: probe.progressive.httpHeaders,
          expiresAt: expiryOf(probe.progressive.url),
        };
        this.cache.set(mediaId, resolved);
        return resolved;
      })
      .finally(() => this.inflight.delete(mediaId));
    this.inflight.set(mediaId, p);
    return p;
  }

  /** 上游 403/410 时失效缓存触发重解析 */
  invalidate(mediaId: number): void {
    this.cache.delete(mediaId);
  }
}
