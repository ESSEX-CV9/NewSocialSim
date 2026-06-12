import type { MediaSearchConfig } from '../search-config.js';
import { buildBooruTags, fetchJson, ratingTags, TagResolver } from './booru.js';
import type { SearchAdapter, SearchOptions, SearchResult } from './types.js';

const BASE = 'https://danbooru.donmai.us';

interface DanbooruPost {
  file_url?: string;
  large_file_url?: string;
  preview_file_url?: string;
  tag_string_general?: string;
  fav_count?: number;
  score?: number;
  image_width?: number;
  image_height?: number;
}

export class DanbooruAdapter implements SearchAdapter {
  readonly name = 'danbooru';

  private readonly resolver = new TagResolver(async (term) => {
    const params = new URLSearchParams({
      'search[query]': term,
      'search[type]': 'tag_query',
      limit: '5',
    });
    const results = (await fetchJson(`${BASE}/autocomplete.json?${params}`)) as {
      value?: string;
      name?: string;
      label?: string;
    }[];
    if (!Array.isArray(results) || results.length === 0) return null;
    return results[0]!.value || results[0]!.name || results[0]!.label || null;
  });

  available(): { ok: boolean } {
    return { ok: true }; // 匿名可用（免费档至多 2 个标签）
  }

  async search(query: string, cfg: MediaSearchConfig, opts: SearchOptions): Promise<SearchResult[]> {
    // Danbooru 免费档至多 2 个标签（rating 标签也占名额，故词条限 1、rating 限 1）
    const rTags = ratingTags('danbooru', opts.rating);
    const tags = await buildBooruTags(query, this.resolver, rTags.slice(0, 1), 1);
    const params = new URLSearchParams({ tags, limit: String(opts.limit) });
    if (cfg.danbooru?.username && cfg.danbooru.apiKey) {
      params.set('login', cfg.danbooru.username);
      params.set('api_key', cfg.danbooru.apiKey);
    }
    const posts = (await fetchJson(`${BASE}/posts.json?${params}`)) as DanbooruPost[];
    if (!Array.isArray(posts)) return [];
    return posts
      .filter((p) => p.file_url || p.large_file_url)
      .map((p) => ({
        url: (p.large_file_url || p.file_url)!,
        preview: p.preview_file_url || p.file_url || p.large_file_url!,
        source: this.name,
        title: p.tag_string_general?.split(' ').slice(0, 5).join(', ') ?? '',
        score: p.fav_count ?? p.score ?? 0,
        width: p.image_width ?? 0,
        height: p.image_height ?? 0,
      }));
  }
}
