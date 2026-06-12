import type { DmStreamEvent } from '@socialsim/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getToken } from '../../api/http';
import { useAuth } from '../../auth/AuthContext';
import { prependDmMessage } from './dmCache';

const DmStreamContext = createContext<{ connected: boolean }>({ connected: false });

/**
 * 私信 SSE 流：登录时挂一条 EventSource，事件到达后写穿/失效 react-query 缓存。
 * 断线由 EventSource 自动重连；connected=false 期间消息页回退轮询兜底。
 * 切账号/登出靠 user.id 依赖重建连接（旧流收的是旧账号的事件）。
 */
export function DmStreamProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const userId = user?.id;

  useEffect(() => {
    const token = getToken();
    if (userId === undefined || !token) return;

    const es = new EventSource(`/api/messages/stream?token=${encodeURIComponent(token)}`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    const parse = <T extends DmStreamEvent['type']>(e: MessageEvent) =>
      JSON.parse(e.data as string) as Extract<DmStreamEvent, { type: T }>;

    es.addEventListener('message:new', (e) => {
      const ev = parse<'message:new'>(e);
      prependDmMessage(queryClient, ev.conversationId, ev.message);
      void queryClient.invalidateQueries({ queryKey: ['dm-conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['dm-unread'] });
    });
    es.addEventListener('message:read', (e) => {
      const ev = parse<'message:read'>(e);
      void queryClient.invalidateQueries({ queryKey: ['dm-conversation', ev.conversationId] });
    });
    es.addEventListener('message:reaction', (e) => {
      const ev = parse<'message:reaction'>(e);
      void queryClient.invalidateQueries({ queryKey: ['dm-messages', ev.conversationId] });
    });
    es.addEventListener('message:deleted', (e) => {
      const ev = parse<'message:deleted'>(e);
      void queryClient.invalidateQueries({ queryKey: ['dm-messages', ev.conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['dm-conversations'] });
    });
    // 服务端热切换清场：连接即将断开。重连会被 401，登出由后续普通请求的 401 广播触发
    es.addEventListener('shutdown', () => setConnected(false));

    return () => {
      es.close();
      setConnected(false);
    };
  }, [userId, queryClient]);

  return <DmStreamContext.Provider value={{ connected }}>{children}</DmStreamContext.Provider>;
}

export function useDmStream(): { connected: boolean } {
  return useContext(DmStreamContext);
}
