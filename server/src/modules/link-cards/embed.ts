/**
 * 可嵌入播放器站点的识别与 embed URL 推导（纯函数）。
 * 链接卡片现算 embedUrl 用；后续视频引入的形态路由（siteModes）共用 site 识别。
 * ID 一律经严格正则校验后再拼接，杜绝把用户输入原样注入 iframe src。
 */

export type EmbedSite = 'youtube' | 'bilibili';

export interface EmbedInfo {
  site: EmbedSite;
  /** 可直接作为 iframe src 的播放器地址 */
  embedUrl: string;
}

const YT_ID = /^[\w-]{11}$/;
const BV_ID = /^BV[0-9A-Za-z]{10}$/;
const AV_ID = /^av(\d+)$/;

/** YouTube 的 t 参数（90 / 90s / 1m30s / 1h2m3s）转秒数；解析失败返回 null */
function parseYoutubeStart(t: string | null): number | null {
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

function youtubeEmbed(u: URL): EmbedInfo | null {
  const host = u.hostname.replace(/^(?:www|m)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') {
    id = u.pathname.split('/')[1] ?? null;
  } else if (host === 'youtube.com' || host === 'music.youtube.com') {
    if (u.pathname === '/watch') {
      id = u.searchParams.get('v');
    } else {
      id = /^\/(?:shorts|live|embed)\/([^/?]+)/.exec(u.pathname)?.[1] ?? null;
    }
  } else {
    return null;
  }
  if (!id || !YT_ID.test(id)) return null;
  const start = parseYoutubeStart(u.searchParams.get('t') ?? u.searchParams.get('start'));
  return {
    site: 'youtube',
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ''}`,
  };
}

function bilibiliEmbed(u: URL): EmbedInfo | null {
  const host = u.hostname.replace(/^(?:www|m)\./, '');
  if (host !== 'bilibili.com') return null;
  const id = /^\/video\/([^/?]+)/.exec(u.pathname)?.[1];
  if (!id) return null;
  let idParam: string | null = null;
  if (BV_ID.test(id)) {
    idParam = `bvid=${id}`;
  } else {
    const av = AV_ID.exec(id);
    if (av) idParam = `aid=${av[1]}`;
  }
  if (!idParam) return null;
  const p = u.searchParams.get('p');
  const page = p && /^\d+$/.test(p) ? `&p=${p}` : '';
  return {
    site: 'bilibili',
    embedUrl: `https://player.bilibili.com/player.html?${idParam}${page}&autoplay=0`,
  };
}

/** URL → 可嵌入播放器信息；不支持的站点 / 解析失败返回 null（b23.tv 短链为已知不支持） */
export function deriveEmbed(url: string): EmbedInfo | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  return youtubeEmbed(u) ?? bilibiliEmbed(u);
}
