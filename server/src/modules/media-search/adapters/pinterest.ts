import type { MediaSearchConfig } from '../search-config.js';
import { SEARCH_UA, type SearchAdapter, type SearchOptions, type SearchResult } from './types.js';

interface PinImage {
  url?: string;
  width?: number;
  height?: number;
}

interface Pin {
  images?: Record<string, PinImage | undefined>;
  image_medium_url?: string;
  grid_title?: string;
  title?: string;
  description?: string;
  original_image_width?: number;
  original_image_height?: number;
}

/**
 * Pinterest 内部 Web API。匿名 BaseSearchResource 已可用（公开关键字搜索无需登录）；
 * 配置了 Cookie 时优先走认证版 SearchResource（个性化内容）。
 */
export class PinterestAdapter implements SearchAdapter {
  readonly name = 'pinterest';
  readonly supportsRating = false;

  available(): { ok: boolean } {
    return { ok: true }; // 匿名可搜
  }

  private getCookieValue(cookieStr: string, name: string): string {
    const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(cookieStr);
    return match?.[1] ?? '';
  }

  private buildHeaders(cookies: string | null): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': SEARCH_UA,
      Accept: 'application/json, text/javascript, */*, q=0.01',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://www.pinterest.com/',
      Origin: 'https://www.pinterest.com',
      'X-Requested-With': 'XMLHttpRequest',
      // 2025-03 反爬升级后的关键绕过头（与 yt-dlp 同款修复）
      'x-pinterest-pws-handler': 'www/pin/[id].js',
      'X-Pinterest-AppState': 'active',
    };
    if (cookies) {
      headers['Cookie'] = cookies;
      const csrf = this.getCookieValue(cookies, 'csrftoken');
      if (csrf) headers['X-CSRFToken'] = csrf;
    }
    return headers;
  }

  private async callResource(
    resource: 'SearchResource' | 'BaseSearchResource',
    query: string,
    limit: number,
    cookies: string | null,
  ): Promise<SearchResult[]> {
    const sourceUrl = `/search/pins/?q=${encodeURIComponent(query)}&rs=typed`;
    const data = {
      options: {
        appliedProductFilters: '---',
        auto_correction_disabled: false,
        bookmarks: [''],
        page_size: limit,
        query,
        redux_normalize_feed: true,
        rs: 'typed',
        scope: 'pins',
        source_url: sourceUrl,
      },
      context: {},
    };
    const params = new URLSearchParams({ source_url: sourceUrl, data: JSON.stringify(data) });
    const res = await fetch(`https://www.pinterest.com/resource/${resource}/get/?${params}`, {
      headers: this.buildHeaders(cookies),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`${resource} HTTP ${res.status}`);
    const json = (await res.json()) as {
      resource_response?: { data?: { results?: Pin[] } | Pin[] };
    };
    const raw = json.resource_response?.data;
    const results = Array.isArray(raw) ? raw : (raw?.results ?? []);
    if (!Array.isArray(results)) return [];

    return results
      .filter((pin) => pin && (pin.images || pin.image_medium_url))
      .slice(0, limit)
      .map((pin) => {
        // 取 736x 而非 orig：原图经代理常超时且可能超过入库大小上限，736x 已足够发帖
        const main = pin.images?.['736x'] ?? pin.images?.['orig'];
        const preview = pin.images?.['236x'] ?? pin.images?.['474x'];
        return {
          url: main?.url || pin.image_medium_url || '',
          preview: preview?.url || pin.image_medium_url || main?.url || '',
          source: this.name,
          title: pin.grid_title || pin.title || pin.description?.slice(0, 100) || '',
          width: main?.width ?? pin.original_image_width ?? 0,
          height: main?.height ?? pin.original_image_height ?? 0,
        };
      })
      .filter((item) => item.url);
  }

  async search(query: string, cfg: MediaSearchConfig, opts: SearchOptions): Promise<SearchResult[]> {
    const cookies = cfg.pinterest?.cookies?.trim() || null;
    // 有 Cookie 先走认证版，失败/空结果降级匿名版
    if (cookies && this.getCookieValue(cookies, 'csrftoken')) {
      try {
        const results = await this.callResource('SearchResource', query, opts.limit, cookies);
        if (results.length > 0) return results;
      } catch {
        // 降级匿名
      }
    }
    return this.callResource('BaseSearchResource', query, opts.limit, null);
  }
}
