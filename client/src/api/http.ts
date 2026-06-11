import type { UserSummary } from '@socialsim/shared';

const ACCOUNTS_KEY = 'socialsim.accounts';
const ACTIVE_KEY = 'socialsim.active';
const LEGACY_TOKEN_KEY = 'socialsim.token';

/** 本地保存的已登录账号（多账号支持；user 为登录时的快照，仅用于菜单展示） */
export interface StoredAccount {
  token: string;
  user: UserSummary;
}

function migrateLegacyToken(): void {
  const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
  if (legacy === null) return;
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  // 旧单 token 没有用户快照，无法迁移成完整账号——直接丢弃，用户重新登录一次即可
}

export function getAccounts(): StoredAccount[] {
  migrateLegacyToken();
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as StoredAccount[]) : [];
  } catch {
    return [];
  }
}

export function setAccounts(accounts: StoredAccount[]): void {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

export function getActiveIndex(): number {
  const n = Number(localStorage.getItem(ACTIVE_KEY) ?? '0');
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export function setActiveIndex(index: number): void {
  localStorage.setItem(ACTIVE_KEY, String(index));
}

/** 活动账号的 token；无账号时为 null */
export function getToken(): string | null {
  const accounts = getAccounts();
  return accounts[getActiveIndex()]?.token ?? accounts[0]?.token ?? null;
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

/** 统一请求入口：带活动账号 token、解析业务错误；401 时广播事件让 AuthContext 处理账号失效 */
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
