import { ValidationError } from './errors/app-error.js';

/** 私网/环回 IPv4 段与 IPv6 等价物（SSRF 防护用） */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local')) return true;
  // IPv6 字面量（URL.hostname 已去掉方括号）
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) {
    if (h.includes(':')) return true;
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/** 校验外链可抓取：仅 http(s)，拒绝环回/私网/链路本地地址；返回解析后的 URL */
export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError('链接格式不正确');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationError('仅支持 http/https 链接');
  }
  if (isPrivateHost(url.hostname)) {
    throw new ValidationError('不允许访问内网地址');
  }
  return url;
}

export interface FetchLimitOptions {
  timeoutMs: number;
  maxBytes: number;
  headers?: Record<string, string>;
}

/**
 * 带超时与字节上限的下载。跟随重定向后再次校验落点（防重定向绕过 SSRF 检查）。
 * 超限直接中断抛错。
 */
export async function fetchWithLimit(
  raw: string,
  opts: FetchLimitOptions,
): Promise<{ buf: Buffer; contentType: string; finalUrl: string }> {
  assertPublicHttpUrl(raw);
  let res: Response;
  try {
    res = await fetch(raw, {
      signal: AbortSignal.timeout(opts.timeoutMs),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        ...opts.headers,
      },
      redirect: 'follow',
    });
  } catch {
    // 网络错误/超时统一映射为业务错误，避免 500
    throw new ValidationError('链接无法访问或超时');
  }
  assertPublicHttpUrl(res.url);
  if (!res.ok) throw new ValidationError(`链接返回 ${res.status}`);
  if (!res.body) throw new ValidationError('链接无响应内容');

  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > opts.maxBytes) {
    await res.body.cancel();
    throw new ValidationError('文件过大');
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > opts.maxBytes) {
      await reader.cancel();
      throw new ValidationError('文件过大');
    }
    chunks.push(value);
  }
  return {
    buf: Buffer.concat(chunks),
    contentType: (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase(),
    finalUrl: res.url,
  };
}
