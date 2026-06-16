import { useEffect, useRef, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview';

/** 活动世界时钟锚点：轮询拾取，本地按流速推算当前世界时间。 */
interface Anchor {
  id: string;
  name: string;
  locale: string;
  contentRating: string;
  scale: number;
  paused: boolean;
  simAnchorMs: number;
  realAnchorMs: number;
}

const POLL_INTERVAL_MS = 3000;
const TICK_INTERVAL_MS = 250;
const SCALES = [1, 2, 5, 20, 60];

function formatSimTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 控制台：卡片栅格布局（对齐 docs/editor-mockup.html）。
 * 「当前世界」卡实时展示世界 + 时钟并提供时钟控制；其余卡（模拟器/快照/世界列表等）随对应功能落地再加。
 */
export function ConsolePanel(_props: IDockviewPanelProps) {
  const anchorRef = useRef<Anchor | null>(null);
  const [, rerender] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function poll(): Promise<void> {
      try {
        const res = await fetch(`${window.editor.backendUrl}/api/worlds/active`);
        if (!res.ok) throw new Error(`backend ${res.status}`);
        const w = (await res.json()) as {
          meta: { id: string; name: string; locale: string; contentRating: string; clock: { scale: number; paused: boolean } };
          simTimeMs: number;
        };
        if (!alive) return;
        anchorRef.current = {
          id: w.meta.id,
          name: w.meta.name,
          locale: w.meta.locale,
          contentRating: w.meta.contentRating,
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
    const tickId = setInterval(() => rerender((t) => t + 1), TICK_INTERVAL_MS);
    return () => {
      alive = false;
      clearInterval(pollId);
      clearInterval(tickId);
    };
  }, []);

  function simNow(): number {
    const a = anchorRef.current;
    if (!a) return 0;
    return a.paused ? a.simAnchorMs : a.simAnchorMs + (Date.now() - a.realAnchorMs) * a.scale;
  }

  async function sendClock(body: Record<string, unknown>): Promise<void> {
    try {
      const res = await fetch(`${window.editor.backendUrl}/api/worlds/clock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`clock ${res.status}`);
      const { clock } = (await res.json()) as { clock: { simTimeMs: number; scale: number; paused: boolean } };
      const prev = anchorRef.current;
      if (prev) {
        anchorRef.current = { ...prev, simAnchorMs: clock.simTimeMs, realAnchorMs: Date.now(), scale: clock.scale, paused: clock.paused };
      }
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  const a = anchorRef.current;
  const currentSim = simNow();
  const btn = 'px-2 py-1 text-xs rounded-lg bg-(--chip) border border-(--border) text-(--text) hover:bg-[#2a2e33] cursor-pointer';
  const btnActive = 'px-2 py-1 text-xs rounded-lg bg-(--blue) border border-(--blue) text-white cursor-pointer';

  return (
    <div className="p-3.5">
      {error && <p className="text-(--pink) text-sm mb-3">编辑器后端不可达：{error}</p>}
      {!a && !error && <p className="text-(--dim) text-sm">连接中…</p>}
      {a && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-(--panel) border border-(--border) rounded-xl px-3.5 py-3">
            <h4 className="flex items-center gap-1.5 text-[13px] font-semibold mb-2">
              <i className="ri-global-line" /> 当前世界
              <span className="ml-auto font-normal text-(--dim) text-xs">{a.id}</span>
            </h4>
            <Kv k="名称" v={a.name} />
            <Kv k="语言 / 分级" v={`${a.locale} / ${a.contentRating}`} />
            <Kv k="模拟时间" v={<span className="font-mono tabular-nums">{formatSimTime(currentSim)}</span>} />
            <Kv k="流速" v={
              <span style={{ color: a.paused ? 'var(--amber)' : 'var(--green)' }}>
                ×{a.scale} · {a.paused ? '已暂停' : '运行中'}
              </span>
            } />

            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <button className={btn} onClick={() => void sendClock({ type: a.paused ? 'resume' : 'pause' })}>
                  <i className={a.paused ? 'ri-play-line' : 'ri-pause-line'} /> {a.paused ? '恢复' : '暂停'}
                </button>
                <span className="text-(--dim) text-xs">流速</span>
                {SCALES.map((s) => (
                  <button key={s} className={a.scale === s ? btnActive : btn} onClick={() => void sendClock({ type: 'setScale', scale: s })}>
                    ×{s}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-(--dim) text-xs">跳转</span>
                <button className={btn} onClick={() => void sendClock({ type: 'setTime', simTimeMs: Math.round(simNow() + 3_600_000) })}>
                  <i className="ri-skip-forward-line" /> +1 时
                </button>
                <button className={btn} onClick={() => void sendClock({ type: 'setTime', simTimeMs: Math.round(simNow() + 86_400_000) })}>
                  <i className="ri-skip-forward-line" /> +1 天
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between py-1 border-b border-[#15171b] text-xs">
      <span className="text-(--dim)">{k}</span>
      <span>{v}</span>
    </div>
  );
}
