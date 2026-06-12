import { SEARCH_UA, type SearchAdapter, type SearchOptions, type SearchResult } from './types.js';

interface WikiPage {
  title?: string;
  imageinfo?: {
    url?: string;
    thumburl?: string;
    mime?: string;
    width?: number;
    height?: number;
    thumbwidth?: number;
    thumbheight?: number;
  }[];
}

export class WikimediaAdapter implements SearchAdapter {
  readonly name = 'wikimedia';

  available(): { ok: boolean } {
    return { ok: true };
  }

  async search(query: string, _cfg: unknown, opts: SearchOptions): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrnamespace: '6', // File 命名空间
      gsrsearch: query,
      gsrlimit: String(Math.min(opts.limit, 20)),
      prop: 'imageinfo',
      iiprop: 'url|size|mime',
      iiurlwidth: '800',
      format: 'json',
      origin: '*',
    });
    const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
      headers: { 'User-Agent': SEARCH_UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { query?: { pages?: Record<string, WikiPage> } };
    const pages = data.query?.pages;
    if (!pages) return [];
    return Object.values(pages)
      .filter((p) => p.imageinfo?.[0]?.mime?.startsWith('image/'))
      .map((p) => {
        const info = p.imageinfo![0]!;
        return {
          url: (info.thumburl || info.url)!,
          preview: (info.thumburl || info.url)!,
          source: this.name,
          title: p.title?.replace('File:', '') ?? '',
          width: info.thumbwidth ?? info.width ?? 0,
          height: info.thumbheight ?? info.height ?? 0,
        };
      });
  }
}
