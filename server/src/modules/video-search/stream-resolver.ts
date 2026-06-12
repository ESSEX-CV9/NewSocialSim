import type { ProgressiveFormat, YtDlp, YtDlpRequestOpts } from './ytdlp.js';

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

const STREAM_TTL_CAP_MS = 4 * 3600 * 1000;
/**
 * 无显式 expire 参数的直链给极短 TTL：rule34video/pornhub 等的签名直链常秒级失效，
 * 长缓存会让后续播放复用陈旧直链导致 403/410。短 TTL 只为合并瞬时并发请求，
 * 实际几乎每次起播都重解析，换取直链总是新鲜（代价是多一次 ~2-3s yt-dlp 解析）。
 */
const UNSIGNED_TTL_MS = 20_000;

/** 直链有效期：有 expire 参数（YouTube 等）按其计；否则给极短 TTL，强制频繁重解析 */
function expiryOf(directUrl: string): number {
  try {
    const e = Number(new URL(directUrl).searchParams.get('expire'));
    if (Number.isFinite(e) && e > 0) {
      return Math.min(Date.now() + STREAM_TTL_CAP_MS, e * 1000 - 60_000);
    }
  } catch {
    // URL 异常时用短 TTL
  }
  return Date.now() + UNSIGNED_TTL_MS;
}

export class StreamResolver {
  private readonly cache = new Map<number, ResolvedStream>();
  private readonly inflight = new Map<number, Promise<ResolvedStream>>();
  /** per-mediaId 串行锁尾：签名直链不支持同签名并发，同源播放请求需排队打源站 */
  private readonly chains = new Map<number, Promise<unknown>>();

  constructor(
    private readonly ytdlp: YtDlp,
    private readonly optsFor: (url: string) => YtDlpRequestOpts,
  ) {}

  /**
   * 把同一 mediaId 的上游访问串行化（rule34video/pornhub 的签名直链对同签名并发返回
   * 403/410，而浏览器播放天然多连接并发）。每个请求接在该 id 的链尾，前一个结束才开始。
   */
  runExclusive<T>(mediaId: number, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(mediaId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    // 链尾推进；当且仅当自己仍是链尾时清理，避免 Map 无限增长
    this.chains.set(mediaId, next);
    void next.finally(() => {
      if (this.chains.get(mediaId) === next) this.chains.delete(mediaId);
    });
    return next;
  }

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
      .probe(originUrl, this.optsFor(originUrl))
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
