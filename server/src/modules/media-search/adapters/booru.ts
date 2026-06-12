import type { SearchRating } from '@socialsim/shared';
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

/** 把查询词（逗号分隔）解析为标签串，并拼接 rating 标签 */
export async function buildBooruTags(
  query: string,
  resolver: TagResolver,
  ratingTags: string[],
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
  return [...tags, ...ratingTags].join(' ').trim();
}

/** 分级 → 各站的 rating 标签：safe 排除成人，all 不过滤，r18 仅成人 */
export function ratingTags(
  site: 'danbooru' | 'gelbooru' | 'yandere',
  rating: SearchRating,
): string[] {
  if (rating === 'all') return [];
  switch (site) {
    case 'danbooru':
      return rating === 'r18' ? ['rating:e'] : ['-rating:e', '-rating:q'];
    case 'gelbooru':
      return rating === 'r18' ? ['rating:explicit'] : ['-rating:explicit', '-rating:questionable'];
    case 'yandere':
      return rating === 'r18' ? ['rating:e'] : ['-rating:e'];
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
