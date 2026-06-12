import type {
  LoginRequest,
  RegisterRequest,
  UserProfile,
  UserSummary,
} from '@socialsim/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../api/endpoints';
import {
  getAccounts,
  getActiveIndex,
  setAccounts,
  setActiveIndex,
  type StoredAccount,
} from '../api/http';

interface AuthOptions {
  /** true = 追加为新账号（多账号），false/缺省 = 替换当前活动账号 */
  append?: boolean;
}

interface AuthValue {
  user: UserProfile | null;
  ready: boolean;
  /** 除活动账号外的其他已登录账号（用于账号菜单展示与切换） */
  otherAccounts: { index: number; user: UserSummary }[];
  login: (input: LoginRequest, options?: AuthOptions) => Promise<void>;
  register: (input: RegisterRequest, options?: AuthOptions) => Promise<void>;
  switchAccount: (index: number) => Promise<void>;
  logout: () => void;
  setUser: (user: UserProfile) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

function toSummary(user: UserProfile): UserSummary {
  return {
    id: user.id,
    handle: user.handle,
    displayName: user.displayName,
    isBot: user.isBot,
    avatarUrl: user.avatarUrl,
    verified: user.verified ?? 'none',
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<UserProfile | null>(null);
  const [accountsState, setAccountsState] = useState<StoredAccount[]>(() => getAccounts());
  const [ready, setReady] = useState(false);

  const persist = useCallback((accounts: StoredAccount[], activeIndex: number) => {
    setAccounts(accounts);
    setActiveIndex(activeIndex);
    setAccountsState(accounts);
  }, []);

  // 启动：用活动账号 token 拉取资料；失败则移除该账号并落到下一个
  useEffect(() => {
    let cancelled = false;
    const tryLoad = async () => {
      // getToken 内部回退到 0 号账号，这里把 active 下标也规范化
      let accounts = getAccounts();
      let active = Math.min(getActiveIndex(), Math.max(0, accounts.length - 1));
      while (accounts.length > 0) {
        setActiveIndex(active);
        try {
          const res = await api.me();
          if (cancelled) return;
          setUserState(res.user);
          // 刷新快照（昵称可能已改）
          const updated = [...accounts];
          updated[active] = { token: accounts[active]!.token, user: toSummary(res.user) };
          persist(updated, active);
          setReady(true);
          return;
        } catch {
          accounts = accounts.filter((_, i) => i !== active);
          active = 0;
          persist(accounts, 0);
        }
      }
      if (!cancelled) {
        setUserState(null);
        setReady(true);
      }
    };
    void tryLoad();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 移除当前活动账号；有其他账号则切过去，否则回未登录态 */
  const dropActiveAccount = useCallback(() => {
    const accounts = getAccounts();
    const active = getActiveIndex();
    const rest = accounts.filter((_, i) => i !== active);
    persist(rest, 0);
    if (rest.length > 0) {
      api
        .me()
        .then((res) => setUserState(res.user))
        .catch(() => setUserState(null));
    } else {
      setUserState(null);
    }
  }, [persist]);

  // 任何请求 401（token 过期/世界切换）→ 当前账号失效
  useEffect(() => {
    window.addEventListener('socialsim:unauthorized', dropActiveAccount);
    return () => window.removeEventListener('socialsim:unauthorized', dropActiveAccount);
  }, [dropActiveAccount]);

  const acceptAuth = useCallback(
    (token: string, profile: UserProfile, options?: AuthOptions) => {
      const accounts = getAccounts();
      const entry: StoredAccount = { token, user: toSummary(profile) };
      if (options?.append || accounts.length === 0) {
        // 同一账号重复登录时去重
        const rest = accounts.filter((a) => a.user.id !== profile.id);
        persist([...rest, entry], rest.length);
      } else {
        const active = getActiveIndex();
        const updated = [...accounts];
        updated[Math.min(active, updated.length - 1)] = entry;
        persist(updated, Math.min(active, updated.length - 1));
      }
      setUserState(profile);
    },
    [persist],
  );

  const login = useCallback(
    async (input: LoginRequest, options?: AuthOptions) => {
      const res = await api.login(input);
      acceptAuth(res.token, res.user, options);
    },
    [acceptAuth],
  );

  const register = useCallback(
    async (input: RegisterRequest, options?: AuthOptions) => {
      const res = await api.register(input);
      acceptAuth(res.token, res.user, options);
    },
    [acceptAuth],
  );

  const switchAccount = useCallback(
    async (index: number) => {
      const accounts = getAccounts();
      if (index < 0 || index >= accounts.length) return;
      persist(accounts, index);
      try {
        const res = await api.me();
        setUserState(res.user);
      } catch {
        // me() 的 401 已触发 dropActiveAccount
      }
    },
    [persist],
  );

  const logout = useCallback(() => {
    dropActiveAccount();
  }, [dropActiveAccount]);

  const setUser = useCallback(
    (u: UserProfile) => {
      setUserState(u);
      const accounts = getAccounts();
      const active = getActiveIndex();
      if (accounts[active]) {
        const updated = [...accounts];
        updated[active] = { token: accounts[active]!.token, user: toSummary(u) };
        persist(updated, active);
      }
    },
    [persist],
  );

  const otherAccounts = useMemo(() => {
    const active = getActiveIndex();
    return accountsState
      .map((a, index) => ({ index, user: a.user }))
      .filter((a) => a.index !== active);
  }, [accountsState]);

  const value = useMemo(
    () => ({ user, ready, otherAccounts, login, register, switchAccount, logout, setUser }),
    [user, ready, otherAccounts, login, register, switchAccount, logout, setUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
