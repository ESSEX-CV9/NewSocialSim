import type { ActiveWorldInfo } from '@socialsim/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../api/endpoints';

interface WorldValue {
  /** null = 没有活动世界（或尚未加载完成） */
  world: ActiveWorldInfo | null;
  ready: boolean;
  /** 此刻的模拟时间（客户端按流速本地推算，定期与服务端校准） */
  simNow: () => number;
  refresh: () => Promise<void>;
}

const WorldContext = createContext<WorldValue | null>(null);

const SYNC_INTERVAL_MS = 60_000;

export function WorldProvider({ children }: { children: ReactNode }) {
  const [world, setWorld] = useState<ActiveWorldInfo | null>(null);
  const [ready, setReady] = useState(false);
  // 校准锚点：服务端模拟时间 + 取回时的本地真实时间
  const anchor = useRef<{ simMs: number; realMs: number; scale: number; paused: boolean } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const info = await api.activeWorld();
      anchor.current = {
        simMs: info.simTimeMs,
        realMs: Date.now(),
        scale: info.meta.clock.scale,
        paused: info.meta.clock.paused,
      };
      setWorld(info);
    } catch {
      anchor.current = null;
      setWorld(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const simNow = useCallback((): number => {
    const a = anchor.current;
    if (!a) return Date.now();
    if (a.paused) return a.simMs;
    return Math.floor(a.simMs + (Date.now() - a.realMs) * a.scale);
  }, []);

  const value = useMemo(() => ({ world, ready, simNow, refresh }), [world, ready, simNow, refresh]);
  return <WorldContext.Provider value={value}>{children}</WorldContext.Provider>;
}

export function useWorld(): WorldValue {
  const ctx = useContext(WorldContext);
  if (!ctx) throw new Error('useWorld must be used within WorldProvider');
  return ctx;
}
