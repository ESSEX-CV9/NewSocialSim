import type { SearchRating } from '@socialsim/shared';
import type { MediaSearchConfig } from '../search-config.js';

/** 各源返回的统一候选格式 */
export interface SearchResult {
  /** 原图 URL（挂帖时经 from-url 下载入库） */
  url: string;
  /** 缩略图 URL（前端直链或经 preview 代理显示） */
  preview: string;
  source: string;
  title: string;
  width: number;
  height: number;
  score?: number;
  /** 下载/预览该图所需的 Referer（如 pixiv 防盗链） */
  referer?: string;
}

export interface SearchOptions {
  /** 本次搜索的分级（世界设定只是默认值；r18 = 仅成人内容） */
  rating: SearchRating;
  limit: number;
}

export interface SourceAvailability {
  ok: boolean;
  /** 不可用原因（i18n key 由前端映射，这里给简短英文标识） */
  reason?: string;
}

export interface SearchAdapter {
  readonly name: string;
  /** 该源是否支持内容分级筛选（前端据此决定是否显示分级下拉） */
  readonly supportsRating: boolean;
  available(cfg: MediaSearchConfig): SourceAvailability;
  search(query: string, cfg: MediaSearchConfig, opts: SearchOptions): Promise<SearchResult[]>;
}

export const SEARCH_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
