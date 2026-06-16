import { useEffect, useMemo, useRef, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import type { StoredSimTraceEvent, SimTraceAction } from '@socialsim/shared';
import { useSelectedTrace, setSelectedTrace } from '../state/selection.js';
import { ACTION_COLOR, ACTION_LABEL, formatSimTime } from './trace-meta.js';
import { Avatar } from './Avatar.js';

/**
 * 时间轴面板（Premiere 范式，见 docs/m5-design.md，样式对齐 editor-mockup.html）：
 * 横轴为时间、纵轴每行一个账号，以当前模拟时间为分界的金色播放头居中——左已发生右待发生——
 * 随模拟时钟向左滚动。左侧轨道栏列被驱动账号；点选块写入全局选中态，详情由检视器面板展示。
 * 块上的真实帖文 / 赞转对象等需回拉数据，留待后续轮次，当前块只标动作。
 */

const LANE_H = 46; // 每条账号轨道高度（px）
const RULER_H = 26; // 顶部时间标尺高度（px）
const ROSTER_W = 160; // 左侧轨道栏宽度
const LABEL_W = 96; // 时间轴行内 lane 标签宽度
const LANE_DIV = '#26292e'; // 轨道分割线（比正文边框淡、比原 #15171b 明显）
const MIN_PPM = 1;
const MAX_PPM = 120;
const POLL_WORLD_MS = 3000;
const TICK_MS = 250; // 播放头随时钟推进的重绘节拍
const NICE_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 240, 360, 720, 1440]; // 网格步长候选（分钟）

interface Anchor {
  scale: number;
  paused: boolean;
  simAnchorMs: number;
  realAnchorMs: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const pad = (n: number) => String(n).padStart(2, '0');
function formatTick(ms: number, withDate: boolean): string {
  const d = new Date(ms);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return withDate ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}` : hm;
}
function niceStepMin(pxPerMin: number): number {
  const target = 90 / pxPerMin;
  return NICE_STEPS.find((n) => n >= target) ?? NICE_STEPS[NICE_STEPS.length - 1]!;
}
/** 互动类动作（赞/转/关注）：mockup 里为灰色小条。 */
function isActAction(a: SimTraceAction): boolean {
  return a === 'like' || a === 'repost' || a === 'follow';
}

export function TimelinePanel(_props: IDockviewPanelProps) {
  const [events, setEvents] = useState<StoredSimTraceEvent[]>([]);
  const [worldId, setWorldId] = useState<string | null>(null);
  const selected = useSelectedTrace();
  const [error, setError] = useState<string | null>(null);
  const [pxPerMin, setPxPerMin] = useState(6);
  const worldRef = useRef<string | null>(null);
  const anchorRef = useRef<Anchor | null>(null);
  const tlRef = useRef<HTMLDivElement | null>(null);
  const [, rerender] = useState(0);

  const backend = window.editor.backendUrl;

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

  // 轮询活动世界：拾取时钟锚点（流速/暂停/当前模拟时间），切世界时重载轨迹。
  useEffect(() => {
    let alive = true;
    async function pollWorld(): Promise<void> {
      try {
        const res = await fetch(`${backend}/api/worlds/active`);
        if (!res.ok) return;
        const w = (await res.json()) as {
          meta?: { id?: string; clock?: { scale?: number; paused?: boolean } };
          simTimeMs?: number;
        };
        if (!alive) return;
        anchorRef.current = {
          scale: w.meta?.clock?.scale ?? 1,
          paused: w.meta?.clock?.paused ?? false,
          simAnchorMs: w.simTimeMs ?? 0,
          realAnchorMs: Date.now(),
        };
        const id = w.meta?.id ?? null;
        if (id !== worldRef.current) {
          worldRef.current = id;
          setWorldId(id);
          setSelectedTrace(null);
          await loadTrace();
        }
      } catch {
        /* 后端暂不可达，下个周期重试 */
      }
    }
    void pollWorld();
    const pid = setInterval(() => void pollWorld(), POLL_WORLD_MS);
    const tid = setInterval(() => rerender((t) => t + 1), TICK_MS);
    return () => {
      alive = false;
      clearInterval(pid);
      clearInterval(tid);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 订阅轨迹 SSE：新轨迹即时追加（按 id 去重）。
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

  // 鼠标在时间轴内 Ctrl+滚轮缩放（围绕居中的"现在"）。
  const ready = events.length > 0;
  useEffect(() => {
    const el = tlRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setPxPerMin((p) => clamp(+(p * (e.deltaY < 0 ? 1.12 : 1 / 1.12)).toFixed(2), MIN_PPM, MAX_PPM));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ready]);

  const { lanes, maxSim } = useMemo(() => {
    const ls = [...new Set(events.map((e) => e.entity))].sort();
    let hi = 0;
    for (const e of events) if (e.simTime > hi) hi = e.simTime;
    return { lanes: ls, maxSim: hi };
  }, [events]);
  const laneIndex = useMemo(() => new Map(lanes.map((l, i) => [l, i])), [lanes]);

  function simNow(): number {
    const a = anchorRef.current;
    if (!a) return maxSim;
    return a.paused ? a.simAnchorMs : a.simAnchorMs + (Date.now() - a.realAnchorMs) * a.scale;
  }
  const now = simNow();

  const stepMin = niceStepMin(pxPerMin);
  const stepPx = stepMin * pxPerMin;
  const gridN = Math.ceil(2500 / stepPx) + 1;
  const withDate = stepMin >= 1440;
  const halfMinWindow = 3000 / pxPerMin;
  const visible = events.filter((e) => Math.abs(e.simTime - now) / 60_000 <= halfMinWindow);
  const offPx = (simTime: number): number => ((simTime - now) / 60_000) * pxPerMin;

  return (
    <div className="flex flex-col h-full text-(--text)">
      {/* 工具条 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-(--border) text-xs">
        <i className="ri-time-line text-(--blue)" />
        <span className="font-semibold">时间轴</span>
        <span className="text-(--dim)">{worldId ?? '—'} · {events.length} 条</span>
        <span className="ml-1 font-mono tabular-nums text-(--amber)" title="当前模拟时间（播放头）">
          {formatSimTime(now)}
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-(--dim)" title="缩放（也可在时间轴内 Ctrl+滚轮）">
          <i className="ri-zoom-out-line" />
          <input
            type="range"
            min={MIN_PPM}
            max={MAX_PPM}
            step={0.5}
            value={pxPerMin}
            onChange={(e) => setPxPerMin(Number(e.target.value))}
            style={{ accentColor: 'var(--blue)' }}
            className="w-28 cursor-pointer"
          />
          <i className="ri-zoom-in-line" />
        </span>
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

      {events.length > 0 && (
        <div className="flex flex-1 min-h-0">
          {/* 左侧轨道栏：列被驱动账号 */}
          <div className="shrink-0 border-r border-(--border) bg-(--panel2) overflow-y-auto" style={{ width: ROSTER_W }}>
            <div className="px-3 py-2 text-xs font-semibold text-(--dim) border-b border-(--border) sticky top-0 bg-(--panel2)">
              轨道
            </div>
            {lanes.map((l) => (
              <div key={l} className="flex items-center gap-2 px-3 py-2 border-b border-[#15171b] text-xs">
                <Avatar handle={l} size={22} />
                <span className="truncate">{l}</span>
              </div>
            ))}
          </div>

          {/* 时间轴：lane 标签列 + 播放头视口 */}
          <div ref={tlRef} className="flex-1 overflow-y-auto overflow-x-hidden">
            <div className="flex min-h-full">
              {/* lane 标签列 */}
              <div className="sticky left-0 z-20 bg-(--panel2) border-r border-(--border) shrink-0" style={{ width: LABEL_W }}>
                <div style={{ height: RULER_H }} className="border-b border-(--border)" />
                {lanes.map((l) => (
                  <div
                    key={l}
                    style={{ height: LANE_H, borderBottom: `1px solid ${LANE_DIV}` }}
                    className="flex items-center gap-1.5 px-2 text-xs text-(--dim) whitespace-nowrap"
                  >
                    <Avatar handle={l} size={18} />
                    <span className="truncate">{l}</span>
                  </div>
                ))}
              </div>

              {/* 播放头视口：now 居中，块按相对 now 的偏移定位 */}
              <div className="relative flex-1 overflow-hidden">
                {/* 网格竖线 + 刻度 */}
                {Array.from({ length: gridN * 2 + 1 }, (_, i) => {
                  const k = i - gridN;
                  if (k === 0) return null;
                  const ms = now + k * stepMin * 60_000;
                  return (
                    <div
                      key={k}
                      className="absolute top-0 bottom-0 border-l border-[#1a1d22]"
                      style={{ left: `calc(50% + ${k * stepPx}px)` }}
                    >
                      <span className="absolute top-0.5 left-1 text-[10px] text-(--dim) whitespace-nowrap">
                        {formatTick(ms, withDate)}
                      </span>
                    </div>
                  );
                })}

                {/* 标尺底边 + 轨道横线 */}
                <div style={{ height: RULER_H }} className="border-b border-(--border)" />
                {lanes.map((l) => (
                  <div key={l} style={{ height: LANE_H, borderBottom: `1px solid ${LANE_DIV}` }} />
                ))}

                {/* 金色播放头 */}
                <div
                  className="absolute top-0 bottom-0 pointer-events-none z-10"
                  style={{ left: '50%', width: 2, background: 'var(--amber)', opacity: 0.75, transform: 'translateX(-1px)' }}
                >
                  <span className="absolute top-0.5 left-1 text-[10px] font-semibold text-(--amber) whitespace-nowrap">现在</span>
                </div>

                {/* 事件块（mockup 圆角条；仅渲染播放头附近时间窗） */}
                {visible.map((e) => {
                  const li = laneIndex.get(e.entity) ?? 0;
                  const isSel = selected?.id === e.id;
                  const isAct = isActAction(e.action);
                  const isFuture = e.simTime > now;
                  const h = isAct ? 18 : 24;
                  const top = RULER_H + li * LANE_H + (LANE_H - h) / 2;
                  const style: React.CSSProperties = {
                    position: 'absolute',
                    left: `calc(50% + ${offPx(e.simTime)}px)`,
                    top,
                    height: h,
                    maxWidth: 230,
                    outline: isSel ? '2px solid #fff' : 'none',
                    outlineOffset: 1,
                  };
                  if (isFuture) {
                    style.background = 'transparent';
                    style.border = `1px dashed ${ACTION_COLOR[e.action]}`;
                    style.color = ACTION_COLOR[e.action];
                  } else if (isAct) {
                    style.background = '#3a3f46';
                    style.color = '#cdd2d6';
                  } else {
                    style.background = ACTION_COLOR[e.action];
                    style.color = '#fff';
                  }
                  return (
                    <button
                      key={e.id}
                      onClick={() => setSelectedTrace(e)}
                      title={`${e.entity} · ${ACTION_LABEL[e.action]} · ${formatSimTime(e.simTime)}`}
                      style={style}
                      className="rounded-md px-2 flex items-center text-[11px] whitespace-nowrap overflow-hidden cursor-pointer hover:brightness-110 z-10"
                    >
                      {ACTION_LABEL[e.action]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
