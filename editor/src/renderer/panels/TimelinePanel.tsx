import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import type { TimelineItem } from '@socialsim/shared';
import { useSelectedBlock, setSelectedBlock } from '../state/selection.js';
import { ACTION_COLOR, formatSimTime } from './trace-meta.js';
import { Avatar } from './Avatar.js';
import { type TimelineBlock, itemKey, itemToBlock, blockLabel } from './timeline-model.js';

/**
 * 时间轴面板（Premiere 范式，见 docs/m5-design.md）：横轴为时间、纵轴每行一个账号，
 * 块 = 世界真实内容。数据源为社交站全站时间流 /api/timeline/global（纯读 world.db、与模拟器
 * 无关，故模拟器未运行也可用）；含帖子/回复/引用 + 转发。向左滚动到头即按游标无限加载更老内容。
 * 以当前模拟时间为分界的金色播放头居中、默认跟随自动横滚、可拖动回看历史，块纵向错行堆叠。
 * 赞/关注等其余互动、跳转任意时间区间、轨迹"为什么"合并待后续服务端工作。
 */

const RULER_H = 26;
const ROSTER_W = 160;
const LABEL_W = 96;
const LANE_DIV = '#26292e';
const SUBROW_H = 26;
const LANE_PAD = 8;
const LANE_MIN_H = 46;
const MIN_PPM = 1;
const MAX_PPM = 120;
const RIGHT_PAD = 300;
const VBUF = 400;
const POLL_WORLD_MS = 3000;
const TICK_MS = 250;
const FEED_LIMIT = 50; // 每页拉取条数（社交站 global 上限 50）
const INITIAL_PAGES = 2; // 初次加载页数
const LOAD_OLDER_AT = 400; // 滚到左侧此阈值内即加载更老
const NICE_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 240, 360, 720, 1440];

interface Anchor {
  scale: number;
  paused: boolean;
  simAnchorMs: number;
  realAnchorMs: number;
}
interface Place {
  laneIdx: number;
  subRow: number;
}
interface Layout {
  place: Map<string, Place>;
  laneHeights: number[];
  laneTops: number[];
  laneRowCounts: number[];
  totalHeight: number;
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
function isActBlock(b: TimelineBlock): boolean {
  return b.kind === 'repost'; // 转发为灰色小条（互动）
}
function estBlockWidth(b: TimelineBlock): number {
  return Math.min(230, blockLabel(b).length * 7 + 18);
}
function blockColor(b: TimelineBlock): string {
  return b.kind === 'repost' ? ACTION_COLOR.repost : ACTION_COLOR[b.action];
}

function computeLayout(blocks: TimelineBlock[], lanes: string[], originSim: number, pxPerMin: number): Layout {
  const ax = (t: number) => ((t - originSim) / 60_000) * pxPerMin;
  const byLane = new Map<string, TimelineBlock[]>(lanes.map((l) => [l, []]));
  for (const b of blocks) byLane.get(b.entity)?.push(b);

  const place = new Map<string, Place>();
  const laneHeights: number[] = [];
  const laneRowCounts: number[] = [];
  for (let i = 0; i < lanes.length; i++) {
    const arr = byLane.get(lanes[i]!)!.slice().sort((a, b) => a.time - b.time);
    const rowsEnd: number[] = [];
    for (const b of arr) {
      const lx = ax(b.time);
      let row = rowsEnd.findIndex((end) => lx >= end);
      if (row === -1) {
        row = rowsEnd.length;
        rowsEnd.push(0);
      }
      rowsEnd[row] = lx + estBlockWidth(b) + 6;
      place.set(b.key, { laneIdx: i, subRow: row });
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
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [worldId, setWorldId] = useState<string | null>(null);
  const selected = useSelectedBlock();
  const [error, setError] = useState<string | null>(null);
  const [pxPerMin, setPxPerMin] = useState(6);
  const [following, setFollowing] = useState(true);
  const [scrollX, setScrollX] = useState(0);
  const [viewW, setViewW] = useState(800);
  const worldRef = useRef<string | null>(null);
  const anchorRef = useRef<Anchor | null>(null);
  const tlRef = useRef<HTMLDivElement | null>(null);
  const expectedLeftRef = useRef(0);
  const keysRef = useRef<Set<string>>(new Set());
  const oldestCursorRef = useRef<string | null>(null);
  const loadingOlderRef = useRef(false);
  const prevMinRef = useRef<number | null>(null);
  const ppmRef = useRef(pxPerMin);
  ppmRef.current = pxPerMin;
  const [, rerender] = useState(0);

  const backend = window.editor.backendUrl;

  async function fetchFeed(cursor?: string): Promise<{ items: TimelineItem[]; nextCursor: string | null }> {
    const u = new URL(`${backend}/api/timeline/global`);
    u.searchParams.set('limit', String(FEED_LIMIT));
    if (cursor) u.searchParams.set('cursor', cursor);
    const r = await fetch(u);
    if (!r.ok) throw new Error(`backend ${r.status}`);
    return (await r.json()) as { items: TimelineItem[]; nextCursor: string | null };
  }

  /** 合并新条目（按 key 去重）。 */
  function addItems(incoming: TimelineItem[]): void {
    const fresh = incoming.filter((it) => {
      const k = itemKey(it);
      if (keysRef.current.has(k)) return false;
      keysRef.current.add(k);
      return true;
    });
    if (fresh.length) setItems((prev) => [...prev, ...fresh]);
  }

  /** 初次加载（切世界 / 刷新）：清空后拉前几页，记录最老游标。 */
  async function loadInitial(): Promise<void> {
    keysRef.current = new Set();
    oldestCursorRef.current = null;
    prevMinRef.current = null;
    setItems([]);
    try {
      let cursor: string | undefined;
      const acc: TimelineItem[] = [];
      for (let p = 0; p < INITIAL_PAGES; p++) {
        const r = await fetchFeed(cursor);
        acc.push(...r.items);
        cursor = r.nextCursor ?? undefined;
        if (!cursor) break;
      }
      oldestCursorRef.current = cursor ?? null;
      addItems(acc);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  /** 向左滚到头：按游标加载更老内容。 */
  async function loadOlder(): Promise<void> {
    if (loadingOlderRef.current || !oldestCursorRef.current) return;
    loadingOlderRef.current = true;
    try {
      const r = await fetchFeed(oldestCursorRef.current);
      addItems(r.items);
      oldestCursorRef.current = r.nextCursor ?? null;
    } catch {
      /* 下次滚动再试 */
    } finally {
      loadingOlderRef.current = false;
    }
  }

  // 轮询活动世界：拾取时钟锚点；切世界则重载，否则拉最新页做实时更新。
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
          setSelectedBlock(null);
          setFollowing(true);
          await loadInitial();
        } else {
          // 实时：拉最新页，合并新内容。
          try {
            const r = await fetchFeed();
            if (alive) addItems(r.items);
          } catch {
            /* 忽略单次失败 */
          }
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

  // 昵称直接来自全站流（每条带 author/repostedBy 的 displayName），无需单独拉取。
  const names = useMemo(() => {
    const m: Record<string, string> = {};
    for (const it of items) {
      m[it.post.author.handle] = it.post.author.displayName;
      if (it.repostedBy) m[it.repostedBy.handle] = it.repostedBy.displayName;
    }
    return m;
  }, [items]);
  const nameOf = (h: string): string => names[h] || h;

  const blocks = useMemo<TimelineBlock[]>(() => items.map(itemToBlock), [items]);

  const { lanes, minTime, maxTime } = useMemo(() => {
    const ls = [...new Set(blocks.map((b) => b.entity))].sort();
    let lo = Infinity;
    let hi = 0;
    for (const b of blocks) {
      if (b.time < lo) lo = b.time;
      if (b.time > hi) hi = b.time;
    }
    return { lanes: ls, minTime: Number.isFinite(lo) ? lo : 0, maxTime: hi };
  }, [blocks]);

  const originSim = minTime - 2 * 60_000;
  const ax = (t: number) => ((t - originSim) / 60_000) * pxPerMin;
  const layout = useMemo(() => computeLayout(blocks, lanes, originSim, pxPerMin), [blocks, lanes, originSim, pxPerMin]);

  function simNow(): number {
    const a = anchorRef.current;
    if (!a) return maxTime;
    return a.paused ? a.simAnchorMs : a.simAnchorMs + (Date.now() - a.realAnchorMs) * a.scale;
  }
  const now = simNow();
  const trackWidth = Math.max(ax(maxTime), ax(now)) + RIGHT_PAD;
  const ready = blocks.length > 0;

  // 加载更老内容使 minTime 减小 → 全部 x 右移；非跟随时补偿 scrollLeft，保持视图稳定。
  useLayoutEffect(() => {
    const el = tlRef.current;
    const prev = prevMinRef.current;
    if (el && prev != null && minTime < prev && !following) {
      el.scrollLeft += ((prev - minTime) / 60_000) * ppmRef.current;
    }
    prevMinRef.current = minTime;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minTime]);

  // 视口宽度（虚拟化）。
  useEffect(() => {
    const el = tlRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, [ready]);

  // Ctrl+滚轮缩放。
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

  // 跟随"现在"：把播放头滚到视口中央（拖动滚动条则停止跟随）。
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
    if (el.scrollLeft < LOAD_OLDER_AT) void loadOlder();
  }

  const stepMin = niceStepMin(pxPerMin);
  const stepPx = stepMin * pxPerMin;
  const stepMs = stepMin * 60_000;
  const withDate = stepMin >= 1440;
  const gxMin = scrollX - LABEL_W - VBUF;
  const gxMax = scrollX - LABEL_W + viewW + VBUF;

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
  const visible = blocks.filter((b) => {
    const x = ax(b.time);
    return x >= gxMin - 240 && x <= gxMax;
  });

  return (
    <div className="flex flex-col h-full text-(--text)">
      {/* 工具条 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-(--border) text-xs">
        <i className="ri-time-line text-(--blue)" />
        <span className="font-semibold">时间轴</span>
        <span className="text-(--dim)">{worldId ?? '—'} · {blocks.length} 块</span>
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
          onClick={() => void loadInitial()}
          className="px-1.5 py-0.5 rounded border border-(--border) bg-(--chip) cursor-pointer hover:bg-[#2a2e33]"
        >
          <i className="ri-refresh-line" /> 刷新
        </button>
      </div>

      {error && <p className="px-3 py-2 text-(--pink) text-xs">编辑器后端不可达：{error}</p>}
      {!error && blocks.length === 0 && (
        <p className="px-3 py-4 text-(--dim) text-sm">该世界暂无内容。建号发帖或启动模拟器后，帖子与转发会在此按时间排布。</p>
      )}

      {blocks.length > 0 && (
        <div className="flex flex-1 min-h-0">
          {/* 左侧轨道栏 */}
          <div className="shrink-0 border-r border-(--border) bg-(--panel2) overflow-y-auto" style={{ width: ROSTER_W }}>
            <div className="px-3 py-2 text-xs font-semibold text-(--dim) border-b border-(--border) sticky top-0 bg-(--panel2)">
              轨道
            </div>
            {lanes.map((l) => (
              <div key={l} className="flex items-center gap-2 px-3 py-2 border-b border-[#15171b] text-xs">
                <Avatar handle={l} name={nameOf(l)} size={28} />
                <div className="min-w-0 leading-tight">
                  <div className="font-semibold truncate">{nameOf(l)}</div>
                  <div className="text-(--dim) text-[11px] truncate">@{l}</div>
                </div>
              </div>
            ))}
          </div>

          {/* 时间轴：可横向滚动 */}
          <div ref={tlRef} onScroll={onScroll} className="flex-1 overflow-auto">
            <div className="flex" style={{ width: LABEL_W + trackWidth, minHeight: '100%' }}>
              {/* lane 标签列 */}
              <div className="sticky left-0 z-20 bg-(--panel2) border-r border-(--border) shrink-0" style={{ width: LABEL_W }}>
                <div style={{ height: RULER_H }} className="border-b border-(--border)" />
                {lanes.map((l, i) => (
                  <div
                    key={l}
                    style={{ height: layout.laneHeights[i], borderBottom: `1px solid ${LANE_DIV}` }}
                    className="flex items-center gap-1.5 px-2 text-xs text-(--dim) whitespace-nowrap"
                  >
                    <Avatar handle={l} name={nameOf(l)} size={18} />
                    <span className="truncate">{nameOf(l)}</span>
                  </div>
                ))}
              </div>

              {/* 轨道画布（绝对时间坐标） */}
              <div className="relative shrink-0" style={{ width: trackWidth, height: layout.totalHeight }}>
                {ticks.map((t) => (
                  <div key={t.ms} className="absolute top-0 bottom-0 border-l border-[#1a1d22]" style={{ left: t.x }}>
                    <span className="absolute top-0.5 left-1 text-[10px] text-(--dim) whitespace-nowrap">
                      {formatTick(t.ms, withDate)}
                    </span>
                  </div>
                ))}

                <div style={{ height: RULER_H }} className="border-b border-(--border)" />
                {lanes.map((l, i) => (
                  <div key={l} style={{ height: layout.laneHeights[i], borderBottom: `1px solid ${LANE_DIV}` }} />
                ))}

                <div
                  className="absolute top-0 bottom-0 pointer-events-none z-10"
                  style={{ left: nowX, width: 2, background: 'var(--amber)', opacity: 0.75, transform: 'translateX(-1px)' }}
                >
                  <span className="absolute top-0.5 left-1 text-[10px] font-semibold text-(--amber) whitespace-nowrap">现在</span>
                </div>

                {visible.map((b) => {
                  const pl = layout.place.get(b.key);
                  if (!pl) return null;
                  const isSel = selected?.key === b.key;
                  const isAct = isActBlock(b);
                  const isFuture = b.time > now;
                  const h = isAct ? 18 : 24;
                  const groupTop = (layout.laneHeights[pl.laneIdx]! - layout.laneRowCounts[pl.laneIdx]! * SUBROW_H) / 2;
                  const top = layout.laneTops[pl.laneIdx]! + groupTop + pl.subRow * SUBROW_H + (SUBROW_H - h) / 2;
                  const color = blockColor(b);
                  const style: React.CSSProperties = {
                    position: 'absolute',
                    left: ax(b.time),
                    top,
                    height: h,
                    maxWidth: 230,
                    outline: isSel ? '2px solid #fff' : 'none',
                    outlineOffset: 1,
                  };
                  if (isFuture) {
                    style.background = 'transparent';
                    style.border = `1px dashed ${color}`;
                    style.color = color;
                  } else if (isAct) {
                    style.background = '#3a3f46';
                    style.color = '#cdd2d6';
                  } else {
                    style.background = color;
                    style.color = '#fff';
                  }
                  return (
                    <button
                      key={b.key}
                      onClick={() => setSelectedBlock(b)}
                      title={`${nameOf(b.entity)} · ${formatSimTime(b.time)}`}
                      style={style}
                      className="rounded-md px-2 flex items-center text-[11px] whitespace-nowrap overflow-hidden cursor-pointer hover:brightness-110 z-10"
                    >
                      {blockLabel(b)}
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
