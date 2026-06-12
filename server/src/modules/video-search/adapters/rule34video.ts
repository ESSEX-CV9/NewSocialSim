import { SEARCH_UA } from '../../media-search/adapters/types.js';
import type { VideoSearchAdapter, VideoSearchDeps, VideoSearchResult } from './types.js';

/**
 * Rule34Video 关键字搜索：自抓搜索页 HTML（站点无公开 API，仿 pinterest 自抓模式）。
 * 下载仍走 yt-dlp。HTML 改版会失效（单源静默降级）。
 */
export class Rule34VideoAdapter implements VideoSearchAdapter {
  readonly name = 'rule34video';

  available(ctx: { ytdlpOk: boolean }) {
    return ctx.ytdlpOk ? { ok: true } : { ok: false, reason: 'no-ytdlp' };
  }

  async search(query: string, limit: number, deps: VideoSearchDeps): Promise<VideoSearchResult[]> {
    // 站内搜索路径为 /search/<空格转+>/
    const slug = encodeURIComponent(query.trim()).replace(/%20/g, '+');
    const res = await fetch(`https://rule34video.com/search/${slug}/`, {
      headers: { 'User-Agent': SEARCH_UA, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`rule34video HTTP ${res.status}`);
    return parseResults(await res.text(), limit);
  }
}

/**
 * 每个视频卡片是 <a class="th js-open-popup" href title> 块；非贪婪一路取到 .time 时长，
 * 顺带捕获缩略图 data-original（不依赖块结束标记，对版式微调更耐受）。
 */
function parseResults(html: string, limit: number): VideoSearchResult[] {
  const results: VideoSearchResult[] = [];
  const cardRe =
    /class="th js-open-popup"\s+href="([^"]+)"\s+title="([^"]*)">[\s\S]*?data-original="([^"]+)"[\s\S]*?<div class="time">([\d:]+)<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(html)) !== null && results.length < limit) {
    const url = m[1]!;
    if (!/\/video\/\d+/.test(url)) continue;
    results.push({
      url,
      title: decodeEntities(m[2] ?? ''),
      thumbnail: m[3] ?? null,
      durationMs: m[4] ? parseDuration(m[4]) : null,
      source: 'rule34video',
    });
  }
  return results;
}

/** mm:ss / hh:mm:ss → 毫秒 */
function parseDuration(s: string): number | null {
  const parts = s.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  let secs = 0;
  for (const p of parts) secs = secs * 60 + p;
  return secs * 1000;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
