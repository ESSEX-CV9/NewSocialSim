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
  /** 不可用原因标识（i18n key 由前端映射）：no-ytdlp */
  reason?: string;
}

export interface VideoSearchDeps {
  ytdlp: YtDlp;
  cfg: MediaSearchConfig;
  proxy: string | undefined;
}

/**
 * 视频源不设内容分级：平台性质本身决定可见内容（YouTube 天然搜不到 R18，
 * Rule34Video 本身即成人站），分级概念无意义，也不受世界 contentRating 约束。
 * 唯一可用性条件是 yt-dlp 是否安装。
 */
export interface VideoSearchAdapter {
  readonly name: string;
  available(ctx: { ytdlpOk: boolean }): VideoSourceAvailability;
  search(query: string, limit: number, deps: VideoSearchDeps): Promise<VideoSearchResult[]>;
}
