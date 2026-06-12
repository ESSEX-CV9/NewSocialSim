import { NotFoundError, ValidationError } from '../../core/errors/app-error.js';
import { fetchWithLimit } from '../../core/safe-fetch.js';
import type { WorldManager } from '../../core/world/world-manager.js';
import { DanbooruAdapter } from './adapters/danbooru.js';
import { GelbooruAdapter } from './adapters/gelbooru.js';
import { PexelsAdapter } from './adapters/pexels.js';
import { PinterestAdapter } from './adapters/pinterest.js';
import { PixivAdapter } from './adapters/pixiv.js';
import type { SearchAdapter, SearchResult } from './adapters/types.js';
import { WikimediaAdapter } from './adapters/wikimedia.js';
import { YandereAdapter } from './adapters/yandere.js';
import { PixivLoginFlow, type LoginStatus } from './pixiv-login.js';
import { patchSearchConfig, readSearchConfig, type MediaSearchConfig } from './search-config.js';

const PER_SOURCE_LIMIT = 20;
/** 预览代理只放行需要 Referer 的防盗链站点 */
const PREVIEW_PROXY_HOSTS: Record<string, string> = {
  'i.pximg.net': 'https://www.pixiv.net/',
  's.pximg.net': 'https://www.pixiv.net/',
};

export interface SourceStatus {
  id: string;
  ok: boolean;
  reason?: string;
}

/** 凭证打码后的配置（GET /config 返回，不外泄明文） */
export interface MaskedConfig {
  proxy: string;
  pixivLoggedIn: boolean;
  pixivAllowR18G: boolean;
  pinterestHasCookies: boolean;
  pexelsHasKey: boolean;
  danbooruHasKey: boolean;
  gelbooruHasKey: boolean;
}

export class MediaSearchService {
  private readonly adapters: SearchAdapter[] = [
    new PinterestAdapter(),
    new PixivAdapter(),
    new DanbooruAdapter(),
    new GelbooruAdapter(),
    new YandereAdapter(),
    new PexelsAdapter(),
    new WikimediaAdapter(),
  ];
  private readonly loginFlow = new PixivLoginFlow();

  constructor(private readonly worldManager: WorldManager) {
    readSearchConfig(); // 启动即加载（应用代理配置）
  }

  sources(): SourceStatus[] {
    const cfg = readSearchConfig();
    return this.adapters.map((a) => {
      const avail = a.available(cfg);
      return { id: a.name, ok: avail.ok, ...(avail.reason ? { reason: avail.reason } : {}) };
    });
  }

  /** 单源直查 / 缺省全可用源并行（单源失败静默吞掉） */
  async search(query: string, source?: string): Promise<SearchResult[]> {
    const q = query.trim();
    if (!q) throw new ValidationError('搜索关键词不能为空');
    const cfg = readSearchConfig();
    const { meta } = this.worldManager.current();
    const opts = { contentRating: meta.contentRating, limit: PER_SOURCE_LIMIT };

    let chosen: SearchAdapter[];
    if (source) {
      const adapter = this.adapters.find((a) => a.name === source);
      if (!adapter) throw new ValidationError(`未知的搜图源：${source}`);
      const avail = adapter.available(cfg);
      if (!avail.ok) throw new ValidationError(`搜图源 ${source} 不可用：${avail.reason ?? ''}`);
      chosen = [adapter];
    } else {
      chosen = this.adapters.filter((a) => a.available(cfg).ok);
    }

    const settled = await Promise.allSettled(chosen.map((a) => a.search(q, cfg, opts)));
    const results: SearchResult[] = [];
    for (const s of settled) {
      if (s.status === 'fulfilled') results.push(...s.value);
    }
    return results;
  }

  /** 防盗链站点的预览图代理（白名单外一律拒绝） */
  async previewProxy(url: string): Promise<{ buf: Buffer; contentType: string }> {
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      throw new ValidationError('链接格式不正确');
    }
    const referer = PREVIEW_PROXY_HOSTS[host];
    if (!referer) throw new NotFoundError('该站点不在预览代理白名单内');
    const { buf, contentType } = await fetchWithLimit(url, {
      timeoutMs: 10_000,
      maxBytes: 10 * 1024 * 1024,
      headers: { Referer: referer },
    });
    return { buf, contentType: contentType || 'image/jpeg' };
  }

  maskedConfig(): MaskedConfig {
    const cfg = readSearchConfig();
    return {
      proxy: cfg.proxy ?? '',
      pixivLoggedIn: !!cfg.pixiv?.refreshToken,
      pixivAllowR18G: cfg.pixiv?.allowR18G ?? false,
      pinterestHasCookies: !!cfg.pinterest?.cookies?.trim(),
      pexelsHasKey: !!cfg.pexels?.apiKey?.trim(),
      danbooruHasKey: !!(cfg.danbooru?.username && cfg.danbooru.apiKey),
      gelbooruHasKey: !!(cfg.gelbooru?.userId && cfg.gelbooru.apiKey),
    };
  }

  patchConfig(patch: Partial<MediaSearchConfig>): MaskedConfig {
    patchSearchConfig(patch);
    return this.maskedConfig();
  }

  pixivLoginStart(): Promise<LoginStatus> {
    return this.loginFlow.start();
  }

  pixivLoginStatus(): LoginStatus {
    return this.loginFlow.status();
  }

  pixivSubmitCode(input: string): Promise<LoginStatus> {
    return this.loginFlow.submitCode(input);
  }
}
