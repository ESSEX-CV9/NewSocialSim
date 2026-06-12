import type { MediaSearchConfig } from '../search-config.js';
import { SEARCH_UA, type SearchAdapter, type SearchOptions, type SearchResult } from './types.js';

interface PexelsPhoto {
  src?: { original?: string; large?: string; medium?: string; small?: string };
  alt?: string;
  photographer?: string;
  width?: number;
  height?: number;
}

export class PexelsAdapter implements SearchAdapter {
  readonly name = 'pexels';

  available(cfg: MediaSearchConfig): { ok: boolean; reason?: string } {
    return cfg.pexels?.apiKey ? { ok: true } : { ok: false, reason: 'missing-api-key' };
  }

  async search(query: string, cfg: MediaSearchConfig, opts: SearchOptions): Promise<SearchResult[]> {
    const apiKey = cfg.pexels?.apiKey;
    if (!apiKey) return [];
    const params = new URLSearchParams({ query, per_page: String(opts.limit) });
    const res = await fetch(`https://api.pexels.com/v1/search?${params}`, {
      headers: { Authorization: apiKey, 'User-Agent': SEARCH_UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { photos?: PexelsPhoto[] };
    return (data.photos ?? [])
      .filter((p) => p.src?.large || p.src?.original)
      .map((p) => ({
        url: (p.src!.large || p.src!.original)!,
        preview: p.src!.medium || p.src!.small || p.src!.large!,
        source: this.name,
        title: p.alt || p.photographer || '',
        width: p.width ?? 0,
        height: p.height ?? 0,
      }));
  }
}
