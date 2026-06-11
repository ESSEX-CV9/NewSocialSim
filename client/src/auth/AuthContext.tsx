import type { LoginRequest, RegisterRequest, UserProfile } from '@socialsim/shared';
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
import { getToken, setToken } from '../api/http';

interface AuthValue {
  user: UserProfile | null;
  ready: boolean;
  login: (input: LoginRequest) => Promise<void>;
  register: (input: RegisterRequest) => Promise<void>;
  logout: () => void;
  /** 资料编辑等场景手动刷新当前用户 */
  setUser: (user: UserProfile) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<UserProfile | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (getToken()) {
      api
        .me()
        .then((res) => {
          if (!cancelled) setUserState(res.user);
        })
        .catch(() => setToken(null))
        .finally(() => {
          if (!cancelled) setReady(true);
        });
    } else {
      setReady(true);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUserState(null);
  }, []);

  // 任何请求遇到 401（含世界切换导致的 token 失效）都登出
  useEffect(() => {
    window.addEventListener('socialsim:unauthorized', logout);
    return () => window.removeEventListener('socialsim:unauthorized', logout);
  }, [logout]);

  const login = useCallback(async (input: LoginRequest) => {
    const res = await api.login(input);
    setToken(res.token);
    setUserState(res.user);
  }, []);

  const register = useCallback(async (input: RegisterRequest) => {
    const res = await api.register(input);
    setToken(res.token);
    setUserState(res.user);
  }, []);

  const setUser = useCallback((u: UserProfile) => setUserState(u), []);

  const value = useMemo(
    () => ({ user, ready, login, register, logout, setUser }),
    [user, ready, login, register, logout, setUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
