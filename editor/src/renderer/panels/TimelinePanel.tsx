import { useEffect, useMemo, useRef, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import type { StoredSimTraceEvent, SimTraceAction } from '@socialsim/shared';
import { useSelectedTrace, setSelectedTrace } from '../state/selection.js';
import { ACTION_COLOR, ACTION_LABEL, formatSimTime } from './trace-meta.js';
import { Avatar } from './Avatar.js';

/**
 * 时间轴面板（Premiere 范式，见 docs/m5-design.md，样式对齐 editor-mockup.html）：
 * 横轴为时间、纵轴每行一个账号，金色播放头标当前模拟时间——左已发生右待发生。
 * 默认跟随"现在"自动横滚；用户拖动滚动条即停止跟随、可回看全部历史，「回到现在」恢复。
 * 同一账号内时间相近的块纵向错行堆叠、互不遮挡。按可视范围虚拟化，避免高倍缩放铺过多 DOM。
 */

const RULER_H = 26;
const ROSTER_W = 160;
const LABEL_W = 96;
const LANE_DIV = '#26292e';
const SUBROW_H = 26; // 堆叠子行行高
const LANE_PAD = 8; // 轨道上下内边距合计
const LANE_MIN_H = 46; // 轨道最小高度（单行时）
const MIN_PPM = 1;
const MAX_PPM = 120;
const RIGHT_PAD = 300; // 轨道右侧留白
const VBUF = 400; // 虚拟化可视范围外缓冲（px）
const POLL_WORLD_MS = 3000;
const TICK_MS = 250;
const NICE_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 240, 360, 720, 1440];

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
function isActAction(a: SimTraceAction): boolean {
  return a === 'like' || a === 'repost' || a === 'follow';
}
/** 块估算宽度（px），用于堆叠碰撞判定。当前块只标动作名故较窄；真实帖文接入后再调。 */
function estBlockWidth(e: StoredSimTraceEvent): number {
  return Math.min(230, ACTION_LABEL[e.action].length * 13 + 18);
}

interface Place {
  laneIdx: number;
  subRow: number;
}
interface Layout {
  place: Map<number, Place>;
  laneHeights: number[];
  laneTops: number[];
  laneRowCounts: number[];
  totalHeight: number;
}

/** 计算每条轨道内的纵向错行堆叠与各轨道高度（绝对时间坐标，与播放头 now 无关）。 */
function computeLayout(events: StoredSimTraceEvent[], lanes: string[], originSim: number, pxPerMin: number): Layout {
  const ax = (t: number) => ((t - originSim) / 60_000) * pxPerMin;
  const byLane = new Map<string, StoredSimTraceEvent[]>(lanes.map((l) => [l, []]));
  for (const e of events) byLane.get(e.entity)?.push(e);

  const place = new Map<number, Place>();
  const laneHeights: number[] = [];
  const laneRowCounts: number[] = [];
  for (let i = 0; i < lanes.length; i++) {
    const arr = byLane.get(lanes[i]!)!.slice().sort((a, b) => a.simTime - b.simTime);
    const rowsEnd: number[] = []; // 每个子行最后一个块的右边沿 x
    for (const e of arr) {
      const lx = ax(e.simTime);
      let row = rowsEnd.findIndex((end) => lx >= end);
      if (row === -1) {
        row = rowsEnd.length;
        rowsEnd.push(0);
      }
      rowsEnd[row] = lx + estBlockWidth(e) + 6;
      place.set(e.id, { laneIdx: i, subRow: row });
    }
    const rowCount = Math.max(1, rowsEnd.length);
    laneRowCounts.push(rowCount);
    laneHeights.push(Math.max(LANE_MIN_H, rowCount * SUBROW_H + LANE_PAD));
  }
  const laneTops: number[] = [];
  let y = RULER_H;
  for (let i = 0; i < lanes.length; i++) {
    laneTops.push(y);
    y += laneHeights[i]!;
  }
  return { place, laneHeights, laneTops, laneRowCounts, totalHeight: y };
}

export function TimelinePanel(_props: IDockviewPanelProps) {
  const [events, setEvents] = useState<StoredSimTraceEvent[]>([]);
  const [worldId, setWorldId] = useState<string | null>(null);
  const selected = useSelectedTrace();
  const [error, setError] = useState<string | null>(null);
  const [pxPerMin, setPxPerMin] = useState(6);
  const [following, setFollowing] = useState(true);
  const [scrollX, setScrollX] = useState(0);
  const [viewW, setViewW] = useState(800);
  const worldRef = useRef<string | null>(null);
  const anchorRef = useRef<Anchor | null>(null);
  const tlRef = useRef<HTMLDivElement | null>(null);
  const expectedLeftRef = useRef(0);
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

  // 轮询活动世界：拾取时钟锚点，切世界时重载轨迹。
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
          setFollowing(true);
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

  // 视口宽度（虚拟化用）。
  const ready = events.length > 0;
  useEffect(() => {
    const el = tlRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, [ready]);

  // 鼠标在时间轴内 Ctrl+滚轮缩放。
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

  const { lanes, minSim, maxSim } = useMemo(() => {
    const ls = [...new Set(events.map((e) => e.entity))].sort();
    let lo = Infinity;
    let hi = 0;
    for (const e of events) {
      if (e.simTime < lo) lo = e.simTime;
      if (e.simTime > hi) hi = e.simTime;
    }
    return { lanes: ls, minSim: Number.isFinite(lo) ? lo : 0, maxSim: hi };
  }, [events]);

  const originSim = minSim - 2 * 60_000; // 左侧留 2 分钟
  const ax = (t: number) => ((t - originSim) / 60_000) * pxPerMin;
  const layout = useMemo(
    () => computeLayout(events, lanes, originSim, pxPerMin),
    [events, lanes, originSim, pxPerMin],
  );

  function simNow(): number {
    const a = anchorRef.current;
    if (!a) return maxSim;
    return a.paused ? a.simAnchorMs : a.simAnchorMs + (Date.now() - a.realAnchorMs) * a.scale;
  }
  const now = simNow();
  const trackWidth = Math.max(ax(maxSim), ax(now)) + RIGHT_PAD;

  // 跟随"现在"：把播放头滚到视口中央（用户拖动滚动条则停止跟随）。
  useEffect(() => {
    if (!following) return;
    const el = tlRef.current;
    if (!el) return;
    const target = clamp(LABEL_W + ax(now) - el.clientWidth / 2, 0, Math.max(0, el.scrollWidth - el.clientWidth));
    expectedLeftRef.current = target;
    el.scrollLeft = target;
  });

  function onScroll(): void {
    const el = tlRef.current;
    if (!el) return;
    if (Math.abs(el.scrollLeft - expectedLeftRef.current) > 3) setFollowing(false);
    setScrollX(el.scrollLeft);
  }

  const stepMin = niceStepMin(pxPerMin);
  const stepPx = stepMin * pxPerMin;
  const stepMs = stepMin * 60_000;
  const withDate = stepMin >= 1440;

  // 虚拟化可视 x 区间（视口坐标，块/网格的 x 即 ax(t)）。
  const gxMin = scrollX - LABEL_W - VBUF;
  const gxMax = scrollX - LABEL_W + viewW + VBUF;

  // 可视网格刻度（对齐到 stepMs 边界取整点时刻）。
  const ticks: { x: number; ms: number }[] = [];
  if (ready) {
    const alignedStart = Math.ceil(originSim / stepMs) * stepMs;
    const kStart = Math.max(0, Math.floor((gxMin - ax(alignedStart)) / stepPx));
    const kEnd = Math.ceil((gxMax - ax(alignedStart)) / stepPx);
    for (let k = kStart; k <= kEnd; k++) {
      const ms = alignedStart + k * stepMs;
      ticks.push({ x: ax(ms), ms });
    }
  }

  const nowX = ax(now);
  const visible = events.filter((e) => {
    const x = ax(e.simTime);
    return x >= gxMin - 240 && x <= gxMax;
  });

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
        {!following && (
          <button
            onClick={() => setFollowing(true)}
            className="px-1.5 py-0.5 rounded border border-(--amber) text-(--amber) cursor-pointer hover:bg-[#2a2418]"
            title="回到当前模拟时间并恢复跟随"
          >
            <i className="ri-focus-3-line" /> 回到现在
          </button>
        )}
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
          {/* 左侧轨道栏 */}
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

          {/* 时间轴：可横向滚动 */}
          <div ref={tlRef} onScroll={onScroll} className="flex-1 overflow-auto">
            <div className="flex" style={{ width: LABEL_W + trackWidth, minHeight: '100%' }}>
              {/* lane 标签列（横滚时固定） */}
              <div className="sticky left-0 z-20 bg-(--panel2) border-r border-(--border) shrink-0" style={{ width: LABEL_W }}>
                <div style={{ height: RULER_H }} className="border-b border-(--border)" />
                {lanes.map((l, i) => (
                  <div
                    key={l}
                    style={{ height: layout.laneHeights[i], borderBottom: `1px solid ${LANE_DIV}` }}
                    className="flex items-center gap-1.5 px-2 text-xs text-(--dim) whitespace-nowrap"
                  >
                    <Avatar handle={l} size={18} />
                    <span className="truncate">{l}</span>
                  </div>
                ))}
              </div>

              {/* 轨道画布（绝对时间坐标） */}
              <div className="relative shrink-0" style={{ width: trackWidth, height: layout.totalHeight }}>
                {/* 网格竖线 + 刻度 */}
                {ticks.map((t) => (
                  <div key={t.ms} className="absolute top-0 bottom-0 border-l border-[#1a1d22]" style={{ left: t.x }}>
                    <span className="absolute top-0.5 left-1 text-[10px] text-(--dim) whitespace-nowrap">
                      {formatTick(t.ms, withDate)}
                    </span>
                  </div>
                ))}

                {/* 标尺底边 + 轨道横线 */}
                <div style={{ height: RULER_H }} className="border-b border-(--border)" />
                {lanes.map((l, i) => (
                  <div key={l} style={{ height: layout.laneHeights[i], borderBottom: `1px solid ${LANE_DIV}` }} />
                ))}

                {/* 金色播放头 */}
                <div
                  className="absolute top-0 bottom-0 pointer-events-none z-10"
                  style={{ left: nowX, width: 2, background: 'var(--amber)', opacity: 0.75, transform: 'translateX(-1px)' }}
                >
                  <span className="absolute top-0.5 left-1 text-[10px] font-semibold text-(--amber) whitespace-nowrap">现在</span>
                </div>

                {/* 事件块（堆叠错行；仅渲染可视范围） */}
                {visible.map((e) => {
                  const pl = layout.place.get(e.id);
                  if (!pl) return null;
                  const isSel = selected?.id === e.id;
                  const isAct = isActAction(e.action);
                  const isFuture = e.simTime > now;
                  const h = isAct ? 18 : 24;
                  // 把堆叠的子行整体在轨道内纵向居中（单行时即 mockup 的居中位置）。
                  const groupTop = (layout.laneHeights[pl.laneIdx]! - layout.laneRowCounts[pl.laneIdx]! * SUBROW_H) / 2;
                  const top = layout.laneTops[pl.laneIdx]! + groupTop + pl.subRow * SUBROW_H + (SUBROW_H - h) / 2;
                  const style: React.CSSProperties = {
                    position: 'absolute',
                    left: ax(e.simTime),
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
