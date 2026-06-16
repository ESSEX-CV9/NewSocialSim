import { useEffect, useMemo, useRef, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import type { StoredSimTraceEvent, SimTraceAction } from '@socialsim/shared';

/**
 * 时间轴面板（= 决策轨迹视图，同一面板）：纵轴账号轨道、横轴模拟时间，每条轨迹落为一个块，
 * 点开块展示该条决策详情。0.10 经 GET /api/trace 载入；并订阅 SSE，0.11 接 ingest 后实时长块。
 */

const LANE_H = 30; // 每条账号轨道高度（px）
const BLOCK_W = 9; // 事件块宽度（px）
const ZOOMS = [2, 6, 18, 60]; // px / 模拟分钟
const POLL_WORLD_MS = 3000;

/** 动作 → 颜色令牌，使时间轴一眼区分发帖/回复/赞等。 */
const ACTION_COLOR: Record<SimTraceAction, string> = {
  post: 'var(--blue)',
  reply: 'var(--green)',
  quote: 'var(--amber)',
  like: 'var(--pink)',
  repost: '#a970ff',
  follow: 'var(--dim)',
};
const ACTION_LABEL: Record<SimTraceAction, string> = {
  post: '发帖', reply: '回复', quote: '引用', like: '赞', repost: '转发', follow: '关注',
};

function formatSimTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function TimelinePanel(_props: IDockviewPanelProps) {
  const [events, setEvents] = useState<StoredSimTraceEvent[]>([]);
  const [worldId, setWorldId] = useState<string | null>(null);
  const [selected, setSelected] = useState<StoredSimTraceEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pxPerMin, setPxPerMin] = useState(6);
  const worldRef = useRef<string | null>(null);

  const backend = window.editor.backendUrl;

  // 载入活动世界的全部轨迹（切世界时重载）。
  async function loadTrace(): Promise<void> {
    try {
      const res = await fetch(`${backend}/api/trace?limit=10000`);
      if (!res.ok) throw new Error(`backend ${res.status}`);
      const { events: rows } = (await res.json()) as { events: StoredSimTraceEvent[] };
      setEvents(rows);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  // 轮询活动世界 id，变化即重载；首挂即载。
  useEffect(() => {
    let alive = true;
    async function pollWorld(): Promise<void> {
      try {
        const res = await fetch(`${backend}/api/worlds/active`);
        if (!res.ok) return;
        const w = (await res.json()) as { meta?: { id?: string } };
        const id = w.meta?.id ?? null;
        if (!alive || id === worldRef.current) return;
        worldRef.current = id;
        setWorldId(id);
        setSelected(null);
        await loadTrace();
      } catch {
        /* 后端暂不可达，下个周期重试 */
      }
    }
    void pollWorld();
    const pid = setInterval(() => void pollWorld(), POLL_WORLD_MS);
    return () => {
      alive = false;
      clearInterval(pid);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 订阅轨迹 SSE：0.11 接 ingest 后，新轨迹即时追加（同库去重按 id）。
  useEffect(() => {
    const es = new EventSource(`${backend}/api/trace/stream`);
    es.addEventListener('trace', (ev) => {
      try {
        const e = JSON.parse((ev as MessageEvent).data) as StoredSimTraceEvent;
        setEvents((prev) => (prev.some((p) => p.id === e.id) ? prev : [...prev, e]));
      } catch {
        /* 丢弃坏帧 */
      }
    });
    return () => es.close();
  }, [backend]);

  // 轨道（账号）与时间跨度。
  const { lanes, minSim, spanMin } = useMemo(() => {
    const ls = [...new Set(events.map((e) => e.entity))].sort();
    if (events.length === 0) return { lanes: ls, minSim: 0, spanMin: 0 };
    let lo = Infinity;
    let hi = -Infinity;
    for (const e of events) {
      if (e.simTime < lo) lo = e.simTime;
      if (e.simTime > hi) hi = e.simTime;
    }
    return { lanes: ls, minSim: lo, spanMin: (hi - lo) / 60_000 };
  }, [events]);

  const laneIndex = useMemo(() => new Map(lanes.map((l, i) => [l, i])), [lanes]);
  const trackWidth = Math.max(spanMin * pxPerMin + BLOCK_W * 2, 200);

  return (
    <div className="flex flex-col h-full text-(--text)">
      {/* 工具条 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-(--border) text-xs">
        <i className="ri-time-line text-(--blue)" />
        <span className="font-semibold">时间轴</span>
        <span className="text-(--dim)">{worldId ?? '—'} · {events.length} 条 · {lanes.length} 账号</span>
        <span className="ml-auto text-(--dim)">缩放</span>
        {ZOOMS.map((z) => (
          <button
            key={z}
            onClick={() => setPxPerMin(z)}
            className={`px-1.5 py-0.5 rounded border cursor-pointer ${
              pxPerMin === z ? 'bg-(--blue) border-(--blue) text-white' : 'bg-(--chip) border-(--border) text-(--text)'
            }`}
          >
            {z}
          </button>
        ))}
        <button
          onClick={() => void loadTrace()}
          className="px-1.5 py-0.5 rounded border border-(--border) bg-(--chip) cursor-pointer hover:bg-[#2a2e33]"
        >
          <i className="ri-refresh-line" /> 刷新
        </button>
      </div>

      {error && <p className="px-3 py-2 text-(--pink) text-xs">编辑器后端不可达：{error}</p>}
      {!error && events.length === 0 && (
        <p className="px-3 py-4 text-(--dim) text-sm">该世界暂无轨迹。启动模拟器后，每次写世界会在此实时长出事件块。</p>
      )}

      {/* 轨道区 */}
      {events.length > 0 && (
        <div className="flex-1 overflow-auto">
          <div className="flex">
            {/* 账号标签列（横向滚动时固定） */}
            <div className="sticky left-0 z-10 bg-(--panel2) border-r border-(--border) shrink-0">
              <div style={{ height: 22 }} className="border-b border-(--border)" />
              {lanes.map((l) => (
                <div
                  key={l}
                  style={{ height: LANE_H }}
                  className="flex items-center px-3 text-xs text-(--dim) border-b border-[#15171b] whitespace-nowrap"
                >
                  {l}
                </div>
              ))}
            </div>

            {/* 轨道画布 */}
            <div className="relative" style={{ width: trackWidth }}>
              {/* 时间标尺（起止） */}
              <div style={{ height: 22 }} className="relative border-b border-(--border) text-[10px] text-(--dim)">
                <span className="absolute left-1 top-1">{formatSimTime(minSim)}</span>
                <span className="absolute right-1 top-1">{formatSimTime(minSim + spanMin * 60_000)}</span>
              </div>
              {/* 轨道横线 */}
              {lanes.map((l) => (
                <div key={l} style={{ height: LANE_H }} className="border-b border-[#15171b]" />
              ))}
              {/* 事件块 */}
              {events.map((e) => {
                const li = laneIndex.get(e.entity) ?? 0;
                const x = ((e.simTime - minSim) / 60_000) * pxPerMin;
                const isSel = selected?.id === e.id;
                return (
                  <button
                    key={e.id}
                    onClick={() => setSelected(e)}
                    title={`${e.entity} · ${ACTION_LABEL[e.action]} · ${formatSimTime(e.simTime)}`}
                    style={{
                      position: 'absolute',
                      left: x,
                      top: 22 + li * LANE_H + 5,
                      width: BLOCK_W,
                      height: LANE_H - 12,
                      background: ACTION_COLOR[e.action],
                      outline: isSel ? '2px solid var(--text)' : 'none',
                      opacity: isSel ? 1 : 0.85,
                    }}
                    className="rounded-sm cursor-pointer hover:opacity-100"
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 选中块详情 */}
      {selected && (
        <div className="border-t border-(--border) bg-(--panel) px-3 py-2.5 text-xs">
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ background: ACTION_COLOR[selected.action] }}
            />
            <span className="font-semibold">{selected.entity}</span>
            <span className="text-(--dim)">{ACTION_LABEL[selected.action]}</span>
            <span className="ml-auto font-mono tabular-nums text-(--dim)">{formatSimTime(selected.simTime)}</span>
            <button onClick={() => setSelected(null)} className="text-(--dim) hover:text-(--text) cursor-pointer">
              <i className="ri-close-line" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            <Kv k="形态 shape" v={selected.shape ?? '—'} />
            <Kv k="意图 intent" v={selected.intent ?? '—'} />
            <Kv k="活动态" v={selected.activityState ?? '—'} />
            <Kv k="池 poolId" v={selected.poolId ?? '—'} />
            <Kv k="条目 entryId" v={selected.entryId ?? '—'} />
            <Kv k="配图" v={selected.mediaAttached ? `是 · ${selected.mediaReason ?? ''}` : '否'} />
            <Kv k="目标帖" v={selected.targetPostId ?? '—'} />
            <Kv k="现实时间" v={formatSimTime(selected.at)} />
          </div>
        </div>
      )}
    </div>
  );
}

function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 py-0.5">
      <span className="text-(--dim) shrink-0">{k}</span>
      <span className="font-mono truncate">{v}</span>
    </div>
  );
}
