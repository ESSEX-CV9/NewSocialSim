import { useEffect, useRef, useState } from 'react';

/** 活动世界实时态：轮询编辑器后端拾取切世界/暂停/调速，本地按流速推算世界时间。供顶栏/状态条共用。 */
export interface ActiveWorldState {
  id: string;
  name: string;
  scale: number;
  paused: boolean;
  currentSimMs: number;
  connected: boolean;
  error: string | null;
}

interface Anchor {
  id: string;
  name: string;
  scale: number;
  paused: boolean;
  simAnchorMs: number;
  realAnchorMs: number;
}

const POLL_INTERVAL_MS = 3000;
const TICK_INTERVAL_MS = 250;

export function useActiveWorld(): ActiveWorldState {
  const anchorRef = useRef<Anchor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, rerender] = useState(0);

  useEffect(() => {
    let alive = true;
    async function poll(): Promise<void> {
      try {
        const res = await fetch(`${window.editor.backendUrl}/api/worlds/active`);
        if (!res.ok) throw new Error(`backend ${res.status}`);
        const w = (await res.json()) as {
          meta: { id: string; name: string; clock: { scale: number; paused: boolean } };
          simTimeMs: number;
        };
        if (!alive) return;
        anchorRef.current = {
          id: w.meta.id,
          name: w.meta.name,
          scale: w.meta.clock.scale,
          paused: w.meta.clock.paused,
          simAnchorMs: w.simTimeMs,
          realAnchorMs: Date.now(),
        };
        setError(null);
      } catch (e) {
        if (alive) setError(String(e));
      }
    }
    void poll();
    const pollId = setInterval(() => void poll(), POLL_INTERVAL_MS);
    const tickId = setInterval(() => rerender((x) => x + 1), TICK_INTERVAL_MS);
    return () => {
      alive = false;
      clearInterval(pollId);
      clearInterval(tickId);
    };
  }, []);

  const a = anchorRef.current;
  const currentSimMs = a ? (a.paused ? a.simAnchorMs : a.simAnchorMs + (Date.now() - a.realAnchorMs) * a.scale) : 0;
  return {
    id: a?.id ?? '',
    name: a?.name ?? '',
    scale: a?.scale ?? 0,
    paused: a?.paused ?? true,
    currentSimMs,
    connected: a !== null,
    error,
  };
}
