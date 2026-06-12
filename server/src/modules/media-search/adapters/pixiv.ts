import { createRequire } from 'node:module';
import type { Pixiv } from '@book000/pixivts';
import type { ContentRating } from '@socialsim/shared';
import type { MediaSearchConfig } from '../search-config.js';
import type { SearchAdapter, SearchOptions, SearchResult } from './types.js';

// pixivts 是 CJS 包且 ESM 命名导出探测失败，运行时经 createRequire 加载
const cjsRequire = createRequire(import.meta.url);
const {
  Pixiv: PixivClass,
  SearchSort,
  SearchTarget,
} = cjsRequire('@book000/pixivts') as typeof import('@book000/pixivts');

const PIXIV_REFERER = 'https://www.pixiv.net/';
/** users入り 标签阈值递减（非会员收藏量筛选的标签拼接法） */
const POPULARITY_THRESHOLDS = [100_000, 50_000, 30_000, 10_000, 5_000];
/** access token 约 60 分钟过期，50 分钟主动重建 */
const REAUTH_INTERVAL_MS = 50 * 60 * 1000;

interface PixivIllust {
  title?: string;
  width?: number;
  height?: number;
  total_bookmarks?: number;
  tags?: { name?: string }[];
  image_urls?: { square_medium?: string; medium?: string; large?: string };
  meta_single_page?: { original_image_url?: string };
}

/**
 * Pixiv App API（@book000/pixivts，refresh token 认证）。
 * 非会员降级策略：popular_desc（会员）→ popular-preview（非会员约 30 条）→
 * "N users入り" 标签阈值递减 → date_desc。
 */
export class PixivAdapter implements SearchAdapter {
  readonly name = 'pixiv';

  private client: Pixiv | null = null;
  private lastAuthAt = 0;

  available(cfg: MediaSearchConfig): { ok: boolean; reason?: string } {
    return cfg.pixiv?.refreshToken ? { ok: true } : { ok: false, reason: 'needs-login' };
  }

  private async ensureClient(refreshToken: string): Promise<Pixiv> {
    const now = Date.now();
    if (this.client && now - this.lastAuthAt < REAUTH_INTERVAL_MS) return this.client;
    this.client = await PixivClass.of(refreshToken);
    this.lastAuthAt = now;
    return this.client;
  }

  private filterIllusts(
    illusts: PixivIllust[],
    rating: ContentRating,
    allowR18G: boolean,
  ): PixivIllust[] {
    return illusts.filter((i) => {
      const tags = (i.tags ?? []).map((t) => t.name?.toLowerCase() ?? '');
      const isR18 = tags.includes('r-18');
      const isR18G = tags.includes('r-18g');
      if (isR18G && !allowR18G) return false;
      if (rating === 'safe' && (isR18 || isR18G)) return false;
      return true;
    });
  }

  private mapResults(illusts: PixivIllust[], limit: number): SearchResult[] {
    return illusts
      .slice(0, limit)
      .map((illust) => {
        const urls = illust.image_urls ?? {};
        const large = urls.large || urls.medium || illust.meta_single_page?.original_image_url || '';
        const preview = urls.medium || urls.square_medium || large;
        return {
          url: large,
          preview,
          source: this.name,
          title: illust.title ?? '',
          score: illust.total_bookmarks ?? 0,
          width: illust.width ?? 0,
          height: illust.height ?? 0,
          referer: PIXIV_REFERER,
        };
      })
      .filter((item) => item.url);
  }

  async search(query: string, cfg: MediaSearchConfig, opts: SearchOptions): Promise<SearchResult[]> {
    const refreshToken = cfg.pixiv?.refreshToken;
    if (!refreshToken) return [];
    const allowR18G = cfg.pixiv?.allowR18G ?? false;

    let pixiv: Pixiv;
    try {
      pixiv = await this.ensureClient(refreshToken);
    } catch {
      this.client = null;
      return [];
    }

    const pick = (illusts: PixivIllust[] | undefined): SearchResult[] | null => {
      if (!illusts || illusts.length === 0) return null;
      const filtered = this.filterIllusts(illusts, opts.contentRating, allowR18G);
      if (filtered.length === 0) return null;
      return this.mapResults(filtered, opts.limit);
    };

    // Tier 1：popular_desc（仅会员，非会员通常报错或空）
    try {
      const res = await pixiv.searchIllust({
        word: query,
        searchTarget: SearchTarget.PARTIAL_MATCH_FOR_TAGS,
        sort: SearchSort.POPULAR_DESC,
      });
      const hit = pick(res.data.illusts as PixivIllust[]);
      if (hit) return hit;
    } catch {
      // 非会员，继续降级
    }

    // Tier 2：popular-preview（非会员可用，约 30 条；pixivts 未封装，用其 http 客户端手调）
    try {
      const res = await pixiv.http.get<{ illusts?: PixivIllust[] }>(
        '/v1/search/popular-preview/illust',
        {
          params: {
            word: query,
            search_target: 'partial_match_for_tags',
            filter: 'for_ios',
            merge_plain_keyword_results: 'true',
          },
        },
      );
      const hit = pick(res.data.illusts);
      if (hit) return hit;
    } catch {
      // 继续降级
    }

    // Tier 3：N users入り 标签阈值递减
    for (const threshold of POPULARITY_THRESHOLDS) {
      try {
        const res = await pixiv.searchIllust({
          word: `${query} ${threshold}users入り`,
          searchTarget: SearchTarget.EXACT_MATCH_FOR_TAGS,
          sort: SearchSort.DATE_DESC,
        });
        const hit = pick(res.data.illusts as PixivIllust[]);
        if (hit) return hit;
      } catch {
        // 试下一档
      }
    }

    // Tier 4：date_desc 兜底
    try {
      const res = await pixiv.searchIllust({
        word: query,
        searchTarget: SearchTarget.PARTIAL_MATCH_FOR_TAGS,
        sort: SearchSort.DATE_DESC,
      });
      return pick(res.data.illusts as PixivIllust[]) ?? [];
    } catch {
      this.client = null; // 认证可能失效，下次重建
      return [];
    }
  }
}
