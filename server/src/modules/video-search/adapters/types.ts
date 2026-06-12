import type { MediaSearchConfig } from '../../media-search/search-config.js';
import type { YtDlp } from '../ytdlp.js';

/** 视频搜索候选（与图片 SearchResult 区分：带时长，无宽高/分级） */
export interface VideoSearchResult {
  /** 视频页面 URL（选中后经 /api/video/ingest 引入） */
  url: string;
  title: string;
  /** 缩略图 URL（前端直链显示，必要时经 preview 代理） */
  thumbnail: string | null;
  durationMs: number | null;
  source: string;
  uploader?: string;
}

export interface VideoSourceAvailability {
  ok: boolean;
  /** 不可用原因标识（i18n key 由前端映射）：no-ytdlp / world-rating */
  reason?: string;
}

export interface VideoSearchDeps {
  ytdlp: YtDlp;
  cfg: MediaSearchConfig;
  proxy: string | undefined;
}

export interface VideoSearchAdapter {
  readonly name: string;
  /** 仅 contentRating='all' 世界可用（成人站点） */
  readonly adultOnly: boolean;
  available(ctx: { ytdlpOk: boolean; contentRating: 'safe' | 'all' }): VideoSourceAvailability;
  search(query: string, limit: number, deps: VideoSearchDeps): Promise<VideoSearchResult[]>;
}
