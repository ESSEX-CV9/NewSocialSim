const TOKEN_KEY = 'socialsim.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token === null) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, token);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

/** 统一请求入口：带 token、解析业务错误；401 时广播事件让 AuthContext 登出 */
export async function http<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : null,
  });
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data ?? {}) as ErrorBody;
    if (res.status === 401) window.dispatchEvent(new Event('socialsim:unauthorized'));
    throw new ApiError(
      err.error?.message ?? res.statusText,
      err.error?.code ?? 'ERROR',
      res.status,
    );
  }
  return data as T;
}
