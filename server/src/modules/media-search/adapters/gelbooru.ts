import type { MediaSearchConfig } from '../search-config.js';
import { buildBooruTags, fetchJson, ratingTags, TagResolver } from './booru.js';
import type { SearchAdapter, SearchOptions, SearchResult } from './types.js';

const BASE = 'https://gelbooru.com';

interface GelbooruPost {
  file_url?: string;
  preview_url?: string;
  tags?: string;
  score?: number;
  width?: number;
  height?: number;
}

export class GelbooruAdapter implements SearchAdapter {
  readonly name = 'gelbooru';

  private readonly resolver = new TagResolver(async (term) => {
    const params = new URLSearchParams({
      page: 'dapi',
      s: 'tag',
      q: 'index',
      json: '1',
      name_pattern: `%${term}%`,
      orderby: 'count',
      limit: '5',
    });
    const data = (await fetchJson(`${BASE}/index.php?${params}`)) as
      | { tag?: { name?: string; count?: number }[] }
      | { name?: string; count?: number }[];
    const tags = Array.isArray(data) ? data : (data.tag ?? []);
    if (!Array.isArray(tags) || tags.length === 0) return null;
    const sorted = [...tags].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
    return sorted[0]!.name ?? null;
  });

  available(cfg: MediaSearchConfig): { ok: boolean; reason?: string } {
    // Gelbooru API 已强制要求 api_key + user_id（匿名返回 401）
    return cfg.gelbooru?.apiKey && cfg.gelbooru.userId
      ? { ok: true }
      : { ok: false, reason: 'missing-api-key' };
  }

  async search(query: string, cfg: MediaSearchConfig, opts: SearchOptions): Promise<SearchResult[]> {
    const tags = await buildBooruTags(query, this.resolver, ratingTags('gelbooru', opts.rating));
    const params = new URLSearchParams({
      page: 'dapi',
      s: 'post',
      q: 'index',
      json: '1',
      tags,
      limit: String(opts.limit),
    });
    if (cfg.gelbooru?.apiKey) params.set('api_key', cfg.gelbooru.apiKey);
    if (cfg.gelbooru?.userId) params.set('user_id', cfg.gelbooru.userId);
    const data = (await fetchJson(`${BASE}/index.php?${params}`)) as
      | { post?: GelbooruPost[] }
      | GelbooruPost[];
    const posts = Array.isArray(data) ? data : (data.post ?? []);
    if (!Array.isArray(posts)) return [];
    return posts
      .filter((p) => p.file_url)
      .map((p) => ({
        url: p.file_url!,
        preview: p.preview_url || p.file_url!,
        source: this.name,
        title: (p.tags ?? '').split(' ').slice(0, 5).join(', '),
        score: p.score ?? 0,
        width: p.width ?? 0,
        height: p.height ?? 0,
      }));
  }
}
