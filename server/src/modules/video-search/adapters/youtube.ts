import type { VideoSearchAdapter, VideoSearchDeps, VideoSearchResult } from './types.js';

/** YouTube 关键字搜索：yt-dlp ytsearchN: 原生支持，免 key，最稳的源 */
export class YouTubeVideoAdapter implements VideoSearchAdapter {
  readonly name = 'youtube';
  readonly adultOnly = false;

  available(ctx: { ytdlpOk: boolean }) {
    return ctx.ytdlpOk ? { ok: true } : { ok: false, reason: 'no-ytdlp' };
  }

  async search(query: string, limit: number, deps: VideoSearchDeps): Promise<VideoSearchResult[]> {
    const entries = await deps.ytdlp.searchFlatPlaylist(`ytsearch${limit}:${query}`, limit, {
      proxy: deps.proxy,
    });
    return entries.map((e) => ({
      url: e.url,
      title: e.title,
      thumbnail: e.thumbnailUrl,
      durationMs: e.durationMs,
      source: this.name,
      ...(e.uploader ? { uploader: e.uploader } : {}),
    }));
  }
}
