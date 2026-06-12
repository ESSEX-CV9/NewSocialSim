import type { ContentRating } from '@socialsim/shared';
import { SEARCH_UA } from './types.js';

/**
 * booru 系（danbooru/gelbooru/yandere）共用的标签解析基建：
 * 自然语言词条经各站 autocomplete/tag API 解析为最热门的站内标签，失败退化为下划线连接。
 */
export class TagResolver {
  private readonly cache = new Map<string, string>();

  constructor(
    private readonly resolveRemote: (term: string) => Promise<string | null>,
  ) {}

  async resolve(term: string): Promise<string> {
    const normalized = term.trim().toLowerCase();
    if (!normalized) return '';
    const hit = this.cache.get(normalized);
    if (hit !== undefined) return hit;
    // 已经是 booru 标签形态（ascii + 下划线）则跳过解析
    if (/^[a-z0-9_()]+$/.test(normalized)) {
      this.cache.set(normalized, normalized);
      return normalized;
    }
    let resolved: string | null = null;
    try {
      resolved = await this.resolveRemote(term.trim());
    } catch {
      resolved = null;
    }
    const tag = resolved || normalized.replace(/\s+/g, '_');
    this.cache.set(normalized, tag);
    return tag;
  }
}

/** 把查询词（逗号分隔）解析为标签串，并拼接 rating 排除项 */
export async function buildBooruTags(
  query: string,
  resolver: TagResolver,
  excludeRatings: string[],
  maxTerms = Infinity,
): Promise<string> {
  const terms = query
    .trim()
    .split(/[,，]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, maxTerms);
  const tags: string[] = [];
  for (const term of terms) {
    const tag = await resolver.resolve(term);
    if (tag) tags.push(tag);
  }
  const excludes = excludeRatings.map((r) => `-rating:${r}`);
  return [...tags, ...excludes].join(' ').trim();
}

/** contentRating → 各站的 rating 排除清单 */
export function ratingExcludes(
  site: 'danbooru' | 'gelbooru' | 'yandere',
  rating: ContentRating,
): string[] {
  if (rating === 'all') return [];
  switch (site) {
    case 'danbooru':
      return ['e', 'q'];
    case 'gelbooru':
      return ['explicit', 'questionable'];
    case 'yandere':
      return ['e'];
  }
}

export async function fetchJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': SEARCH_UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
