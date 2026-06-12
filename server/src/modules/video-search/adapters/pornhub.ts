import type { VideoSearchAdapter, VideoSearchDeps, VideoSearchResult } from './types.js';

/** Pornhub 关键字搜索：yt-dlp 内置 extractor 支持搜索结果页 flat-playlist */
export class PornhubVideoAdapter implements VideoSearchAdapter {
  readonly name = 'pornhub';

  available(ctx: { ytdlpOk: boolean }) {
    return ctx.ytdlpOk ? { ok: true } : { ok: false, reason: 'no-ytdlp' };
  }

  async search(query: string, limit: number, deps: VideoSearchDeps): Promise<VideoSearchResult[]> {
    const target = `https://www.pornhub.com/video/search?search=${encodeURIComponent(query)}`;
    const entries = await deps.ytdlp.searchFlatPlaylist(target, limit, { proxy: deps.proxy });
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
