import type { LinkCardView } from '@socialsim/shared';
import { fetchWithLimit } from '../../core/safe-fetch.js';
import type { WorldManager } from '../../core/world/world-manager.js';
import { mediaFileUrl, type MediaService } from '../media/media.service.js';
import { linkCardsRepo } from './link-cards.repo.js';

const FETCH_TIMEOUT_MS = 5_000;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 300;

/** 提取正文中的首个 http(s) URL（去掉常见的尾随标点）；无则 null */
export function extractFirstUrl(content: string): string | null {
  const m = /https?:\/\/[^\s]+/.exec(content);
  if (!m) return null;
  return m[0].replace(/[)\]}>,.;!?'"、。，；！？）】」』]+$/, '');
}

/** 常见 HTML 实体反转义（OG 文案足够，不引依赖） */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** 从 HTML 提取 <meta property|name="<prop>" content="...">（容忍属性顺序颠倒与单双引号） */
function metaContent(html: string, prop: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${prop}["'][^>]*?content\\s*=\\s*["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*?(?:property|name)\\s*=\\s*["']${prop}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m && m[1]) return decodeEntities(m[1]).trim();
  }
  return null;
}

/** 按 content-type / meta charset 解码 HTML（未知编码回退 utf-8） */
function decodeHtml(buf: Buffer, contentTypeCharset: string | null): string {
  const tryDecode = (charset: string): string | null => {
    try {
      return new TextDecoder(charset).decode(buf);
    } catch {
      return null;
    }
  };
  if (contentTypeCharset) {
    const s = tryDecode(contentTypeCharset);
    if (s !== null) return s;
  }
  const utf8 = new TextDecoder('utf-8').decode(buf);
  const m = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(utf8);
  if (m && m[1] && m[1].toLowerCase() !== 'utf-8') {
    const s = tryDecode(m[1]);
    if (s !== null) return s;
  }
  return utf8;
}

export class LinkCardsService {
  constructor(
    private readonly worldManager: WorldManager,
    private readonly mediaService: MediaService,
  ) {}

  /**
   * 抓取并缓存 URL 的 OG 元数据（缩略图下载入库）；任何失败写 failed 缓存。
   * 不抛错——链接卡片失败不应阻断发帖。
   */
  async resolve(url: string, ownerId: number): Promise<void> {
    const { db } = this.worldManager.current();
    if (linkCardsRepo.find(db, url)) return;

    try {
      const { buf, contentType, finalUrl } = await fetchWithLimit(url, {
        timeoutMs: FETCH_TIMEOUT_MS,
        maxBytes: MAX_HTML_BYTES,
        headers: { Accept: 'text/html,application/xhtml+xml' },
      });
      if (contentType !== 'text/html' && contentType !== 'application/xhtml+xml') {
        throw new Error(`不是 HTML：${contentType}`);
      }
      const html = decodeHtml(buf, null);

      const title =
        metaContent(html, 'og:title') ??
        (/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim()
          ? decodeEntities(/<title[^>]*>([^<]*)<\/title>/i.exec(html)![1]!.trim())
          : null);
      if (!title) throw new Error('无标题');

      const description = metaContent(html, 'og:description') ?? metaContent(html, 'description');
      const siteName = metaContent(html, 'og:site_name');
      const ogImage = metaContent(html, 'og:image');

      // 缩略图下载入库（失败不影响卡片本身）
      let imageMediaId: number | null = null;
      if (ogImage) {
        try {
          const absolute = new URL(ogImage, finalUrl).href;
          const media = await this.mediaService.ingestImageFromUrl(ownerId, absolute, 'linkcard');
          imageMediaId = media.id;
        } catch {
          imageMediaId = null;
        }
      }

      // 抓取是异步的，期间可能热切换了世界：写库前重新取当前上下文并核对
      const after = this.worldManager.current();
      linkCardsRepo.upsert(after.db, {
        url,
        title: title.slice(0, MAX_TITLE),
        description: description ? description.slice(0, MAX_DESCRIPTION) : null,
        image_media_id: imageMediaId,
        site_name: siteName,
        status: 'ok',
        fetchedAt: after.clock.now(),
      });
    } catch {
      try {
        const after = this.worldManager.current();
        linkCardsRepo.upsert(after.db, {
          url,
          title: null,
          description: null,
          image_media_id: null,
          site_name: null,
          status: 'failed',
          fetchedAt: after.clock.now(),
        });
      } catch {
        // 世界不可用等极端情况：放弃缓存
      }
    }
  }

  /** 批量查卡片缓存（仅返回成功条目），供 posts.service.buildViews 用 */
  viewsForUrls(urls: string[]): Map<string, LinkCardView> {
    const { db, worldId } = this.worldManager.current();
    const rows = linkCardsRepo.findMany(db, [...new Set(urls)]);
    const map = new Map<string, LinkCardView>();
    for (const row of rows) {
      if (row.status !== 'ok' || row.title === null) continue;
      map.set(row.url, {
        url: row.url,
        title: row.title,
        description: row.description,
        imageUrl: mediaFileUrl(row.image_media_id, worldId),
        siteName: row.site_name,
      });
    }
    return map;
  }
}
