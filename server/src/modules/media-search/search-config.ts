import fs from 'node:fs';
import path from 'node:path';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { config } from '../../config.js';

/** 实例级搜图凭证与配置（data/media-search.json，不入 git，不属于任何世界） */
export interface MediaSearchConfig {
  /** 全局 HTTP 代理（如 http://127.0.0.1:7890）：pixiv/pinterest 在部分网络环境必需 */
  proxy?: string;
  pixiv?: {
    refreshToken?: string;
    /** R-18G 即使 contentRating=all 也默认不放行 */
    allowR18G?: boolean;
  };
  pinterest?: {
    /** 可选：浏览器 Cookie（匿名搜索已可用，登录态用于个性化内容） */
    cookies?: string;
  };
  pexels?: { apiKey?: string };
  danbooru?: { username?: string; apiKey?: string };
  gelbooru?: { userId?: string; apiKey?: string };
  /** 视频工具下载源覆盖（镜像加速）；留空用 GitHub 官方 release */
  tools?: { ytdlpUrl?: string; ffmpegUrl?: string };
  /** 视频引入设置（下载限额仅约束下载模式；siteModes 为可嵌入站点的形态路由覆盖） */
  video?: {
    maxHeight?: number;
    maxDownloadMb?: number;
    defaultMode?: 'download' | 'stream';
    hlsFallback?: 'download' | 'error';
    siteModes?: { youtube?: 'embed' | 'download' | 'stream'; bilibili?: 'embed' | 'download' | 'stream' };
  };
}

/** video 段解析后的有效值（缺省补默认） */
export interface VideoSettings {
  maxHeight: number;
  maxBytes: number;
  defaultMode: 'download' | 'stream';
  hlsFallback: 'download' | 'error';
  siteModes: { youtube?: 'embed' | 'download' | 'stream'; bilibili?: 'embed' | 'download' | 'stream' };
}

export function videoSettings(cfg: MediaSearchConfig): VideoSettings {
  return {
    maxHeight: cfg.video?.maxHeight ?? 720,
    maxBytes: (cfg.video?.maxDownloadMb ?? 150) * 1024 * 1024,
    defaultMode: cfg.video?.defaultMode ?? 'download',
    hlsFallback: cfg.video?.hlsFallback ?? 'error',
    siteModes: cfg.video?.siteModes ?? {},
  };
}

const FILE = path.join(config.dataDir, 'media-search.json');

let cached: MediaSearchConfig | null = null;
let proxyApplied: string | null = null;

/** 配置代理：经 undici 全局 dispatcher 作用于本进程所有 fetch（含 pixivts 内部） */
function applyProxy(cfg: MediaSearchConfig): void {
  const proxy = cfg.proxy?.trim() || null;
  if (proxy === proxyApplied) return;
  if (proxy) {
    setGlobalDispatcher(new ProxyAgent(proxy));
  }
  // 取消代理需要重启进程（undici 无公开的恢复默认 dispatcher API），文档注明
  proxyApplied = proxy;
}

export function readSearchConfig(): MediaSearchConfig {
  if (cached) return cached;
  let cfg: MediaSearchConfig = {};
  if (fs.existsSync(FILE)) {
    try {
      // 容忍 Windows 编辑器写入的 UTF-8 BOM
      cfg = JSON.parse(
        fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''),
      ) as MediaSearchConfig;
    } catch {
      cfg = {};
    }
  }
  cached = cfg;
  applyProxy(cfg);
  return cfg;
}

/** 局部合并写入（顶层与每个源各自浅合并），写无 BOM utf8 */
export function patchSearchConfig(patch: Partial<MediaSearchConfig>): MediaSearchConfig {
  const current = readSearchConfig();
  const next: MediaSearchConfig = {
    ...current,
    ...(patch.proxy !== undefined ? { proxy: patch.proxy } : {}),
    ...(patch.pixiv !== undefined ? { pixiv: { ...current.pixiv, ...patch.pixiv } } : {}),
    ...(patch.pinterest !== undefined
      ? { pinterest: { ...current.pinterest, ...patch.pinterest } }
      : {}),
    ...(patch.pexels !== undefined ? { pexels: { ...current.pexels, ...patch.pexels } } : {}),
    ...(patch.danbooru !== undefined ? { danbooru: { ...current.danbooru, ...patch.danbooru } } : {}),
    ...(patch.gelbooru !== undefined ? { gelbooru: { ...current.gelbooru, ...patch.gelbooru } } : {}),
    ...(patch.tools !== undefined ? { tools: { ...current.tools, ...patch.tools } } : {}),
    ...(patch.video !== undefined
      ? {
          video: {
            ...current.video,
            ...patch.video,
            ...(patch.video.siteModes !== undefined
              ? { siteModes: { ...current.video?.siteModes, ...patch.video.siteModes } }
              : {}),
          },
        }
      : {}),
  };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2), 'utf8');
  cached = next;
  applyProxy(next);
  return next;
}
