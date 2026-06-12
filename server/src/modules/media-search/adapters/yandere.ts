import { buildBooruTags, fetchJson, ratingTags, TagResolver } from './booru.js';
import type { SearchAdapter, SearchOptions, SearchResult } from './types.js';

const BASE = 'https://yande.re';

interface YanderePost {
  file_url?: string;
  sample_url?: string;
  preview_url?: string;
  tags?: string;
  score?: number;
  width?: number;
  height?: number;
}

export class YandereAdapter implements SearchAdapter {
  readonly name = 'yandere';
  readonly supportsRating = true;

  private readonly resolver = new TagResolver(async (term) => {
    const params = new URLSearchParams({ name: term, order: 'count', limit: '5' });
    const tags = (await fetchJson(`${BASE}/tag.json?${params}`)) as {
      name?: string;
      count?: number;
    }[];
    if (!Array.isArray(tags) || tags.length === 0) return null;
    const sorted = [...tags].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
    return sorted[0]!.name ?? null;
  });

  available(): { ok: boolean } {
    return { ok: true };
  }

  async search(query: string, _cfg: unknown, opts: SearchOptions): Promise<SearchResult[]> {
    const tags = await buildBooruTags(query, this.resolver, ratingTags('yandere', opts.rating));
    const params = new URLSearchParams({ tags, limit: String(opts.limit) });
    const posts = (await fetchJson(`${BASE}/post.json?${params}`)) as YanderePost[];
    if (!Array.isArray(posts)) return [];
    return posts
      .filter((p) => p.file_url || p.sample_url)
      .map((p) => ({
        url: (p.sample_url || p.file_url)!,
        preview: p.preview_url || p.sample_url || p.file_url!,
        source: this.name,
        title: (p.tags ?? '').split(' ').slice(0, 5).join(', '),
        score: p.score ?? 0,
        width: p.width ?? 0,
        height: p.height ?? 0,
      }));
  }
}
