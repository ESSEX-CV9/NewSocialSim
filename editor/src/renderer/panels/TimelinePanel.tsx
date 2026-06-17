import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import type { TimelineItem, PostView, InteractionEvent, UserSummary } from '@socialsim/shared';
import { useSelectedBlock, setSelectedBlock } from '../state/selection.js';
import { ACTION_COLOR, formatSimTime } from './trace-meta.js';
import { Avatar } from './Avatar.js';
import { type TimelineBlock, interactionKey, interactionToBlock, postToBlock, blockLabel } from './timeline-model.js';

/**
 * 时间轴面板（Premiere 范式，见 docs/m5-design.md）：横轴为时间、纵轴每行一个账号，
 * 块 = 世界真实内容、独立于模拟器。主轴为社交站全站流 /api/timeline/global（顶层帖、所有账号、
 * 无限向后滚动）；按账号补拉回复（?type=replies）与转发（/timeline 的 type=repost）。
 * 顶层时间为可输入的时间修改器，改时间即跳转视图。赞/关注互动、按时间区间跳转待后续服务端工作。
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
const FEED_LIMIT = 50;
const INITIAL_PAGES = 2;
const EXTRA_PAGE_CAP = 4; // 每账号回复/转发拉取页数上限（深度历史待 time-range 端点）
const LOAD_OLDER_AT = 400;
const DAY_MS = 86_400_000;
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
/** 刻度标签：偏离当前时间超 24h（或步长达天级）则带日期。 */
function formatTick(ms: number, withDate: boolean): string {
  const d = new Date(ms);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return withDate ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}` : hm;
}
/** 解析"YYYY-MM-DD HH:MM[:SS]"（即 formatSimTime 的格式）为模拟时间 ms；非法返回 null。
 *  按本地分量构造，与 formatSimTime 用本地 getter 一致，往返不偏移；这是世界模拟时间、非系统时间。 */
function parseSimTime(s: string): number | null {
  const m = s.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? '0')).getTime();
  return Number.isFinite(t) ? t : null;
}
function niceStepMin(pxPerMin: number): number {
  const target = 90 / pxPerMin;
  return NICE_STEPS.find((n) => n >= target) ?? NICE_STEPS[NICE_STEPS.length - 1]!;
}
function isActBlock(b: TimelineBlock): boolean {
  return b.kind !== 'post'; // 赞/转/关注均为灰色小条（互动）
}
function estBlockWidth(b: TimelineBlock): number {
  return Math.min(230, blockLabel(b).length * 7 + 18);
}
function blockColor(b: TimelineBlock): string {
  return b.kind === 'post' ? ACTION_COLOR[b.action] : ACTION_COLOR[b.kind];
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
  const [posts, setPosts] = useState<PostView[]>([]); // 顶层帖（global）+ 回复（per-account）
  const [acts, setActs] = useState<Array<{ actor: string; ev: InteractionEvent }>>([]); // 赞/转/关注（per-account）
  const [roster, setRoster] = useState<Array<{ handle: string; displayName: string }>>([]); // 全部账号（轨道列全）
  const [worldId, setWorldId] = useState<string | null>(null);
  const selected = useSelectedBlock();
  const [error, setError] = useState<string | null>(null);
  const [pxPerMin, setPxPerMin] = useState(6);
  const [following, setFollowing] = useState(true);
  const [scrollX, setScrollX] = useState(0);
  const [viewW, setViewW] = useState(800);
  const [editingTime, setEditingTime] = useState<string | null>(null);
  const worldRef = useRef<string | null>(null);
  const anchorRef = useRef<Anchor | null>(null);
  const tlRef = useRef<HTMLDivElement | null>(null);
  const expectedLeftRef = useRef(0);
  const postIdsRef = useRef<Set<number>>(new Set());
  const actKeysRef = useRef<Set<string>>(new Set());
  const fetchedExtraRef = useRef<Set<string>>(new Set());
  const oldestCursorRef = useRef<string | null>(null);
  const loadingOlderRef = useRef(false);
  const prevMinRef = useRef<number | null>(null);
  const ppmRef = useRef(pxPerMin);
  ppmRef.current = pxPerMin;
  const pendingJumpRef = useRef<number | null>(null);
  const [, rerender] = useState(0);

  const backend = window.editor.backendUrl;

  async function fetchFeed(
    opts?: { cursor?: string | undefined; to?: number | undefined },
  ): Promise<{ items: TimelineItem[]; nextCursor: string | null }> {
    const u = new URL(`${backend}/api/timeline/global`);
    u.searchParams.set('limit', String(FEED_LIMIT));
    if (opts?.cursor) u.searchParams.set('cursor', opts.cursor);
    if (opts?.to != null) u.searchParams.set('to', String(Math.round(opts.to))); // T.2 时间区间跳转
    const r = await fetch(u);
    if (!r.ok) throw new Error(`backend ${r.status}`);
    return (await r.json()) as { items: TimelineItem[]; nextCursor: string | null };
  }

  function addPosts(views: PostView[]): void {
    const fresh = views.filter((p) => {
      if (postIdsRef.current.has(p.id)) return false;
      postIdsRef.current.add(p.id);
      return true;
    });
    if (fresh.length) setPosts((prev) => [...prev, ...fresh]);
  }
  function addActs(actor: string, events: InteractionEvent[]): void {
    const fresh = events.filter((ev) => {
      const k = interactionKey(actor, ev);
      if (actKeysRef.current.has(k)) return false;
      actKeysRef.current.add(k);
      return true;
    });
    if (fresh.length) setActs((prev) => [...prev, ...fresh.map((ev) => ({ actor, ev }))]);
  }
  /** 把一页全站流并入：取顶层帖（转发等互动改由 per-account /interactions 取）。 */
  function ingestFeed(items: TimelineItem[]): void {
    addPosts(items.filter((it) => it.type === 'post').map((it) => it.post));
  }

  /** 列全部账号（分页拉全）→ 轨道列全，含从未发帖者。 */
  async function loadRoster(): Promise<void> {
    try {
      const all: Array<{ handle: string; displayName: string }> = [];
      let cursor: string | undefined;
      for (let p = 0; p < 20; p++) {
        const u = new URL(`${backend}/api/users`);
        u.searchParams.set('limit', '50');
        if (cursor) u.searchParams.set('cursor', cursor);
        const r = await fetch(u);
        if (!r.ok) break;
        const j = (await r.json()) as { items: UserSummary[]; nextCursor: string | null };
        all.push(...j.items.map((x) => ({ handle: x.handle, displayName: x.displayName })));
        if (!j.nextCursor) break;
        cursor = j.nextCursor;
      }
      setRoster(all);
    } catch {
      /* 拉不到则退回从内容发现账号 */
    }
  }

  async function loadInitial(): Promise<void> {
    postIdsRef.current = new Set();
    actKeysRef.current = new Set();
    fetchedExtraRef.current = new Set();
    oldestCursorRef.current = null;
    prevMinRef.current = null;
    setPosts([]);
    setActs([]);
    setRoster([]);
    void loadRoster();
    try {
      let cursor: string | undefined;
      const acc: TimelineItem[] = [];
      for (let p = 0; p < INITIAL_PAGES; p++) {
        const r = await fetchFeed({ cursor });
        acc.push(...r.items);
        cursor = r.nextCursor ?? undefined;
        if (!cursor) break;
      }
      oldestCursorRef.current = cursor ?? null;
      ingestFeed(acc);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function loadOlder(): Promise<void> {
    if (loadingOlderRef.current || !oldestCursorRef.current) return;
    loadingOlderRef.current = true;
    try {
      const r = await fetchFeed({ cursor: oldestCursorRef.current });
      ingestFeed(r.items);
      oldestCursorRef.current = r.nextCursor ?? null;
    } catch {
      /* 下次再试 */
    } finally {
      loadingOlderRef.current = false;
    }
  }

  /** 拉某账号的回复 + 转发（封顶若干页）。 */
  async function fetchAccountExtra(handle: string): Promise<void> {
    // 回复
    try {
      let cursor: string | undefined;
      const reps: PostView[] = [];
      for (let p = 0; p < EXTRA_PAGE_CAP; p++) {
        const u = new URL(`${backend}/api/users/${encodeURIComponent(handle)}/posts`);
        u.searchParams.set('type', 'replies');
        u.searchParams.set('limit', '50');
        if (cursor) u.searchParams.set('cursor', cursor);
        const r = await fetch(u);
        if (!r.ok) break;
        const j = (await r.json()) as { items: PostView[]; nextCursor: string | null };
        reps.push(...j.items);
        if (!j.nextCursor) break;
        cursor = j.nextCursor;
      }
      addPosts(reps);
    } catch {
      /* ignore */
    }
    // 互动（赞/转/关注）
    try {
      let cursor: string | undefined;
      const evs: InteractionEvent[] = [];
      for (let p = 0; p < EXTRA_PAGE_CAP; p++) {
        const u = new URL(`${backend}/api/users/${encodeURIComponent(handle)}/interactions`);
        u.searchParams.set('limit', '50');
        if (cursor) u.searchParams.set('cursor', cursor);
        const r = await fetch(u);
        if (!r.ok) break;
        const j = (await r.json()) as { items: InteractionEvent[]; nextCursor: string | null };
        evs.push(...j.items);
        if (!j.nextCursor) break;
        cursor = j.nextCursor;
      }
      addActs(handle, evs);
    } catch {
      /* ignore */
    }
  }

  // 轮询活动世界：拾取时钟锚点；切世界则重载，否则拉最新页实时更新。
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
          try {
            const r = await fetchFeed();
            if (alive) ingestFeed(r.items);
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

  // 账号 = 全部账号 roster ∪ 顶层帖作者（roster 拉不到时退回作者发现）→ 补拉各自回复与互动。
  const accounts = useMemo(
    () => [...new Set([...roster.map((r) => r.handle), ...posts.map((p) => p.author.handle)])].sort(),
    [roster, posts],
  );
  useEffect(() => {
    const missing = accounts.filter((h) => !fetchedExtraRef.current.has(h));
    if (missing.length === 0) return;
    let alive = true;
    missing.forEach((h) => fetchedExtraRef.current.add(h));
    void (async () => {
      for (const h of missing) {
        if (!alive) return;
        await fetchAccountExtra(h);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, backend]);

  // 昵称取自 roster + 帖子 / 互动里携带的 displayName。
  const names = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of roster) m[r.handle] = r.displayName;
    for (const p of posts) m[p.author.handle] = p.author.displayName;
    for (const a of acts) {
      if (a.ev.type === 'follow') m[a.ev.target.handle] = a.ev.target.displayName;
      else m[a.ev.post.author.handle] = a.ev.post.author.displayName;
    }
    return m;
  }, [roster, posts, acts]);
  const nameOf = (h: string): string => names[h] || h;

  const blocks = useMemo<TimelineBlock[]>(
    () => [...posts.map(postToBlock), ...acts.map((a) => interactionToBlock(a.actor, names[a.actor] || a.actor, a.ev))],
    [posts, acts, names],
  );

  const { lanes, minTime, maxTime } = useMemo(() => {
    // 轨道 = 内容里出现的账号 ∪ 全部账号 roster（含从未发帖者）
    const ls = [...new Set([...blocks.map((b) => b.entity), ...roster.map((r) => r.handle)])].sort();
    let lo = Infinity;
    let hi = 0;
    for (const b of blocks) {
      if (b.time < lo) lo = b.time;
      if (b.time > hi) hi = b.time;
    }
    return { lanes: ls, minTime: Number.isFinite(lo) ? lo : 0, maxTime: hi };
  }, [blocks, roster]);

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

  /** 跳转视图到某时间（停止跟随）。目标早于已加载最早内容时，单请求按时间区间拉取该窗口（T.2），
   *  直接落到目标附近，而非从最新游标逐页回翻。 */
  async function jumpToTime(t: number): Promise<void> {
    setFollowing(false);
    if (!ready || t < minTime) {
      const halfWinMs = ((viewW / Math.max(0.1, ppmRef.current)) * 60_000) / 2;
      try {
        const r = await fetchFeed({ to: t + halfWinMs });
        ingestFeed(r.items);
      } catch {
        /* 拉不到则停在现有范围 */
      }
    }
    pendingJumpRef.current = t;
    rerender((x) => x + 1);
  }
  function commitTimeEdit(): void {
    if (editingTime) {
      const t = parseSimTime(editingTime);
      if (t != null) void jumpToTime(t);
    }
    setEditingTime(null);
  }

  // 处理跳转：窗口已并入后，滚到目标时间居中并清除待跳转。
  useEffect(() => {
    const t = pendingJumpRef.current;
    if (t == null) return;
    const el = tlRef.current;
    if (!el) return;
    const target = clamp(LABEL_W + ax(t) - el.clientWidth / 2, 0, Math.max(0, el.scrollWidth - el.clientWidth));
    el.scrollLeft = target;
    expectedLeftRef.current = target;
    setScrollX(target);
    pendingJumpRef.current = null;
  });

  // 加载更老使 minTime 减小 → x 右移；非跟随且非跳转中时补偿 scrollLeft。
  useLayoutEffect(() => {
    const el = tlRef.current;
    const prev = prevMinRef.current;
    if (el && prev != null && minTime < prev && !following && pendingJumpRef.current == null) {
      el.scrollLeft += ((prev - minTime) / 60_000) * ppmRef.current;
    }
    prevMinRef.current = minTime;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minTime]);

  useEffect(() => {
    const el = tlRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, [ready]);

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
  const gxMin = scrollX - LABEL_W - VBUF;
  const gxMax = scrollX - LABEL_W + viewW + VBUF;

  const ticks: { x: number; label: string }[] = [];
  if (ready) {
    const alignedStart = Math.ceil(originSim / stepMs) * stepMs;
    const kStart = Math.max(0, Math.floor((gxMin - ax(alignedStart)) / stepPx));
    const kEnd = Math.ceil((gxMax - ax(alignedStart)) / stepPx);
    for (let k = kStart; k <= kEnd; k++) {
      const ms = alignedStart + k * stepMs;
      const withDate = stepMin >= 1440 || Math.abs(ms - now) > DAY_MS;
      ticks.push({ x: ax(ms), label: formatTick(ms, withDate) });
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
        <input
          type="text"
          spellCheck={false}
          value={editingTime ?? formatSimTime(now)}
          onFocus={() => setEditingTime(formatSimTime(now))}
          onChange={(e) => setEditingTime(e.target.value)}
          onBlur={commitTimeEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitTimeEdit();
              e.currentTarget.blur();
            }
          }}
          title="输入模拟时间跳转（格式 2026-06-17 14:30:00，世界模拟时间非系统时间）"
          className="w-38 bg-(--chip) border border-(--border) rounded px-1.5 py-0.5 text-(--amber) font-mono tabular-nums cursor-text focus:border-(--amber) outline-none"
        />
        <span className="text-(--dim)">{worldId ?? '—'} · {blocks.length} 块</span>
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
        <p className="px-3 py-4 text-(--dim) text-sm">该世界暂无内容。建号发帖或启动模拟器后，帖子/回复/转发会在此按时间排布。</p>
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
          <div ref={tlRef} onScroll={onScroll} className="tl-scroll flex-1 overflow-auto">
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
                  <div key={t.x} className="absolute top-0 bottom-0 border-l border-[#1a1d22]" style={{ left: t.x }}>
                    <span className="absolute top-0.5 left-1 text-[10px] text-(--dim) whitespace-nowrap">{t.label}</span>
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
