import { useEffect, useRef, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview';

/** 活动世界时钟锚点：轮询拾取，本地按流速推算当前世界时间。 */
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

function formatSimTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 控制台·读态：实时展示活动世界与时钟。
 * 轮询编辑器后端拾取切世界/暂停/调速，两次轮询间本地按流速推算世界时间使其平滑走字。
 * 时钟控制（0.7）与模拟器状态（0.8）将续长在此面板。
 */
export function ConsolePanel(_props: IDockviewPanelProps) {
  const anchorRef = useRef<Anchor | null>(null);
  const [, forceRerender] = useState(0);
  const [error, setError] = useState<string | null>(null);

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
    const tickId = setInterval(() => forceRerender((t) => t + 1), TICK_INTERVAL_MS);
    return () => {
      alive = false;
      clearInterval(pollId);
      clearInterval(tickId);
    };
  }, []);

  const a = anchorRef.current;
  const currentSim = a
    ? a.paused
      ? a.simAnchorMs
      : a.simAnchorMs + (Date.now() - a.realAnchorMs) * a.scale
    : 0;

  return (
    <div className="p-4 space-y-3">
      <h2 className="text-sm font-semibold text-gray-300">控制台</h2>
      {error && <p className="text-red-400 text-sm">编辑器后端不可达：{error}</p>}
      {!a && !error && <p className="text-gray-400 text-sm">连接中…</p>}
      {a && (
        <div className="space-y-3">
          <div>
            <p className="text-gray-500 text-xs">活动世界</p>
            <p className="text-lg font-semibold">
              {a.name} <span className="text-gray-500 text-sm">({a.id})</span>
            </p>
          </div>
          <div className="flex gap-8">
            <div>
              <p className="text-gray-500 text-xs">流速</p>
              <p className="text-gray-200">×{a.scale}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">状态</p>
              <p className={a.paused ? 'text-amber-400' : 'text-green-400'}>{a.paused ? '已暂停' : '运行中'}</p>
            </div>
          </div>
          <div>
            <p className="text-gray-500 text-xs">世界时间</p>
            <p className="text-xl font-mono tabular-nums">{formatSimTime(currentSim)}</p>
          </div>
        </div>
      )}
    </div>
  );
}
