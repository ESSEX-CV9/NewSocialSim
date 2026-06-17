import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import type { PostView, InteractionEvent, UserSummary } from '@socialsim/shared';
import { useSelectedBlock, setSelectedBlock } from '../state/selection.js';
import { ACTION_COLOR, formatSimTime } from './trace-meta.js';
import { Avatar } from './Avatar.js';
import { type TimelineBlock, interactionKey, interactionToBlock, postToBlock, blockLabel } from './timeline-model.js';

/**
 * 时间轴面板（Premiere 范式，见 docs/m5-design.md）：横轴为时间、纵轴每行一个账号，
 * 块 = 世界真实内容（帖子/回复/引用/转发/赞/关注）、**独立于模拟器**（读 world.db，模拟器关也能用）。
 * 取数走编辑器后端单一聚合端点 GET /api/timeline（roster + 顶层帖 + 各账号回复/互动），
 * 按**可见时间窗口**加载：初始取最新内容，向左滚/跳转/轮询各取一个时间窗（含该时段全部互动）。
 * 顶层时间为可输入的时间修改器，改时间即跳转视图。
 */

const RULER_H = 26;
const ROSTER_W = 200;
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
const DAY_MS = 86_400_000;
const INITIAL_AXIS_SPAN = 7 * DAY_MS; // 初始横轴左界 = 最新内容前 7 天（可自由拖滚到此范围）
const AXIS_EXTEND = 3 * DAY_MS; // 拖到左边缘时再往更早扩 3 天
const AXIS_EDGE_PX = 600; // 距左边缘多少像素内触发扩展
const PREFETCH_CHUNK_MS = 12 * 3_600_000; // 后台预取每块 12 小时
const PREFETCH_GAP_MS = 40; // 预取块之间让步间隔，避免占满
const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));
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
  // 轨道筛选（T.6）：null = 全部账号；非空集 = 只看选中账号的轨道（纯视图过滤，数据已在内存）。
  const [laneFilter, setLaneFilter] = useState<Set<string> | null>(null);
  const [laneSearch, setLaneSearch] = useState(''); // 轨道管理面板的账号搜索词（昵称/@handle）
  const [showInactive, setShowInactive] = useState(false); // 是否展开"未活跃账号"分组
  // 横轴左界（模拟时间）：稳定、独立于已加载内容，使可拖滚到任意时段、内容按需加载。
  const [axisFrom, setAxisFrom] = useState<number | null>(null);
  const worldRef = useRef<string | null>(null);
  const anchorRef = useRef<Anchor | null>(null);
  const tlRef = useRef<HTMLDivElement | null>(null);
  const expectedLeftRef = useRef(0);
  const postIdsRef = useRef<Set<number>>(new Set());
  const actKeysRef = useRef<Set<string>>(new Set());
  const coverToRef = useRef<number | null>(null); // 已加载到的最新时间（轮询据此向"现在"续接）
  // 最近一次按可见窗口加载的区间；可见窗口落在其内则跳过重复加载。
  const lastLoadFromRef = useRef(Infinity);
  const lastLoadToRef = useRef(-Infinity);
  const originSimRef = useRef(0); // 当前 originSim（时间↔x 映射），供滚动时由像素反推可见时间
  const scrollLoadTimerRef = useRef<number | null>(null);
  const prevAxisFromRef = useRef<number | null>(null); // axisFrom 减小（左扩）时补偿 scrollLeft
  const prefetchTokenRef = useRef(0); // 后台预取取消令牌（切世界/刷新即作废旧循环）
  const ppmRef = useRef(pxPerMin);
  ppmRef.current = pxPerMin;
  const viewWRef = useRef(viewW); // 供 poll useEffect 的陈旧闭包里读到当前视宽
  viewWRef.current = viewW;
  const pendingJumpRef = useRef<number | null>(null);
  const [, rerender] = useState(0);

  const backend = window.editor.backendUrl;

  // T.3：renderer 的单一取数接口——编辑器后端聚合 roster + 顶层帖 + 各账号回复/互动。
  interface TimelineResult {
    accounts: UserSummary[];
    posts: PostView[];
    interactions: Array<{ actor: string; ev: InteractionEvent }>;
    nextCursor: string | null;
  }
  async function fetchTimeline(opts?: { from?: number | undefined; to?: number | undefined }): Promise<TimelineResult> {
    const u = new URL(`${backend}/api/timeline`);
    u.searchParams.set('limit', String(FEED_LIMIT));
    if (opts?.from != null) u.searchParams.set('from', String(Math.round(opts.from)));
    if (opts?.to != null) u.searchParams.set('to', String(Math.round(opts.to)));
    const r = await fetch(u);
    if (!r.ok) throw new Error(`backend ${r.status}`);
    return (await r.json()) as TimelineResult;
  }

  /** 加载某时间窗口的完整内容（顶层帖 + 回复 + 互动 + roster），并入既有数据（按 id/key 去重）。
   *  不加互斥——用户滚动取数与后台预取可并发（结果幂等去重），互斥会让用户取数被后台挤掉。 */
  async function loadWindow(from: number, to: number): Promise<void> {
    try {
      const r = await fetchTimeline({ from, to });
      if (r.accounts.length) setRoster(r.accounts.map((a) => ({ handle: a.handle, displayName: a.displayName })));
      addPosts(r.posts);
      ingestInteractions(r.interactions);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  /** 后台预取：初始秒显后，由近及远把 [fromTime, toTime] 按 12h 一块悄悄拉完，
   *  使拖滚到该范围任意时段时数据已在内存、瞬间出现。切世界/刷新令牌作废即停。 */
  function startPrefetch(fromTime: number, toTime: number): void {
    const token = ++prefetchTokenRef.current;
    void (async () => {
      let cursor = toTime;
      while (cursor > fromTime) {
        if (prefetchTokenRef.current !== token) return; // 已作废
        const from = Math.max(fromTime, cursor - PREFETCH_CHUNK_MS);
        await loadWindow(from, cursor);
        cursor = from;
        await sleep(PREFETCH_GAP_MS);
      }
    })();
  }

  /** 一次加载的时间跨度：至少 1.5 个可见屏宽或 6 小时（缩得越远一次取越多）。 */
  function loadStepMs(): number {
    const visMs = (viewWRef.current / Math.max(0.1, ppmRef.current)) * 60_000;
    return Math.max(visMs * 1.5, 6 * 3_600_000);
  }

  function addPosts(views: PostView[]): void {
    const fresh = views.filter((p) => {
      if (postIdsRef.current.has(p.id)) return false;
      postIdsRef.current.add(p.id);
      return true;
    });
    if (fresh.length) setPosts((prev) => [...prev, ...fresh]);
  }
  function ingestInteractions(list: Array<{ actor: string; ev: InteractionEvent }>): void {
    const fresh = list.filter(({ actor, ev }) => {
      const k = interactionKey(actor, ev);
      if (actKeysRef.current.has(k)) return false;
      actKeysRef.current.add(k);
      return true;
    });
    if (fresh.length) setActs((prev) => [...prev, ...fresh]);
  }

  /** 初始/刷新：取最新实际内容（非窗口、最新在前）——世界时钟可能远超内容（模拟器停了时钟仍走），
   *  故不能假设内容在"现在"附近。时钟明显领先内容时把视图落到最新内容、停跟随。 */
  async function loadInitial(): Promise<void> {
    postIdsRef.current = new Set();
    actKeysRef.current = new Set();
    prevAxisFromRef.current = null;
    lastLoadFromRef.current = Infinity;
    lastLoadToRef.current = -Infinity;
    setPosts([]);
    setActs([]);
    setRoster([]);
    const now = simNow();
    try {
      const r = await fetchTimeline(); // 非窗口：最新顶层帖 + roster + 近期互动
      if (r.accounts.length) setRoster(r.accounts.map((a) => ({ handle: a.handle, displayName: a.displayName })));
      addPosts(r.posts);
      ingestInteractions(r.interactions);
      const times = r.posts.map((p) => p.createdAt);
      const latest = times.length ? Math.max(...times) : now;
      const oldest = times.length ? Math.min(...times) : now;
      lastLoadFromRef.current = oldest; // 初始非窗口取回的内容时间跨度
      lastLoadToRef.current = now;
      coverToRef.current = now; // 轮询从 now 续接新内容
      setAxisFrom(latest - INITIAL_AXIS_SPAN); // 稳定横轴左界（可拖滚回最新内容前 7 天）
      if (now - latest > 30 * 60_000) {
        // 时钟领先内容超 30 分钟（模拟器空闲）：落到最新内容、停跟随，否则播放头在空白处
        setFollowing(false);
        pendingJumpRef.current = latest;
      }
      setError(null);
      // 后台把整条初始轴（最新内容前 7 天）预取完，使拖滚到任意时段都即时
      if (times.length) startPrefetch(latest - INITIAL_AXIS_SPAN, latest);
    } catch (e) {
      setError(String(e));
    }
  }

  /** 按当前可见时间窗口加载（滚动/拖动滚动条到任意位置后调用）：由滚动像素反推可见时间，
   *  加载该窗口前后各一个 step 的完整内容（含历史回复/互动）。可见窗口落在上次加载区间内则跳过。 */
  function loadVisibleWindow(): void {
    const el = tlRef.current;
    if (!el) return;
    const ppm = Math.max(0.1, ppmRef.current);
    const origin = originSimRef.current;
    const xLeft = el.scrollLeft - LABEL_W;
    const vFrom = origin + (xLeft / ppm) * 60_000;
    const vTo = origin + ((xLeft + viewWRef.current) / ppm) * 60_000;
    const half = Math.max(loadStepMs(), vTo - vFrom); // 至少一个 step 或一屏，作半宽
    const from = (vFrom + vTo) / 2 - half;
    const to = (vFrom + vTo) / 2 + half;
    if (from >= lastLoadFromRef.current && to <= lastLoadToRef.current) return; // 已在上次加载窗口内
    lastLoadFromRef.current = from;
    lastLoadToRef.current = to;
    void loadWindow(from, to);
  }

  /** 滚动停下后（防抖）按可见窗口加载。 */
  function scheduleVisibleLoad(): void {
    if (scrollLoadTimerRef.current != null) window.clearTimeout(scrollLoadTimerRef.current);
    scrollLoadTimerRef.current = window.setTimeout(() => loadVisibleWindow(), 200);
  }

  /** 轮询：把覆盖区间往"现在"扩，拉入新产生的内容。 */
  async function loadNewer(): Promise<void> {
    const now = simNow();
    const from = coverToRef.current ?? now - loadStepMs();
    if (now - from < 1000) return; // 暂停或无新内容
    coverToRef.current = now;
    await loadWindow(from, now);
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
          if (alive) await loadNewer();
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
      prefetchTokenRef.current++; // 卸载即停后台预取
      clearInterval(pid);
      clearInterval(tid);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const { allLanes, minTime, maxTime } = useMemo(() => {
    // 全部轨道 = 内容里出现的账号 ∪ 全部账号 roster（含从未发帖者）
    const ls = [...new Set([...blocks.map((b) => b.entity), ...roster.map((r) => r.handle)])].sort();
    let lo = Infinity;
    let hi = 0;
    for (const b of blocks) {
      if (b.time < lo) lo = b.time;
      if (b.time > hi) hi = b.time;
    }
    return { allLanes: ls, minTime: Number.isFinite(lo) ? lo : 0, maxTime: hi };
  }, [blocks, roster]);
  // 实际渲染的轨道：有筛选则取交集（保留 allLanes 顺序）。excluded 账号的块因不在 lane 内自然不渲染。
  const lanes = useMemo(
    () => (laneFilter ? allLanes.filter((l) => laneFilter.has(l)) : allLanes),
    [allLanes, laneFilter],
  );

  /** 切换某账号在筛选中的选中态；从"全部"切换即以全集为起点去掉它，回到全集则归零为 null。 */
  function toggleLane(handle: string): void {
    setLaneFilter((prev) => {
      const next = new Set(prev ?? allLanes);
      if (next.has(handle)) next.delete(handle);
      else next.add(handle);
      if (next.size === allLanes.length) return null; // 全选 = 无筛选
      return next;
    });
  }
  const isLaneOn = (h: string): boolean => (laneFilter ? laneFilter.has(h) : true);

  // 有内容的账号（出现在 blocks 里）；其余为"未活跃"（roster 里从未发帖/互动）。
  const activeSet = useMemo(() => new Set(blocks.map((b) => b.entity)), [blocks]);
  // 轨道管理面板：按搜索词过滤后分"有内容 / 未活跃"两组（昵称或 @handle 命中即留）。
  const manager = useMemo(() => {
    const q = laneSearch.trim().toLowerCase();
    const hit = (h: string): boolean => !q || h.toLowerCase().includes(q) || (names[h] || '').toLowerCase().includes(q);
    const active: string[] = [];
    const inactive: string[] = [];
    for (const h of allLanes) {
      if (!hit(h)) continue;
      (activeSet.has(h) ? active : inactive).push(h);
    }
    return { active, inactive };
  }, [allLanes, activeSet, laneSearch, names]);

  // 横轴起点用稳定的 axisFrom（独立于已加载内容），故可拖滚到任意时段；未就绪前回退到 minTime。
  const originSim = (axisFrom ?? minTime) - 2 * 60_000;
  originSimRef.current = originSim; // 供滚动时由像素反推可见时间
  const ax = (t: number) => ((t - originSim) / 60_000) * pxPerMin;
  const layout = useMemo(() => computeLayout(blocks, lanes, originSim, pxPerMin), [blocks, lanes, originSim, pxPerMin]);

  function simNow(): number {
    const a = anchorRef.current;
    if (!a) return maxTime;
    return a.paused ? a.simAnchorMs : a.simAnchorMs + (Date.now() - a.realAnchorMs) * a.scale;
  }
  const now = simNow();
  const trackWidth = Math.max(ax(maxTime), ax(now)) + RIGHT_PAD;
  const ready = allLanes.length > 0; // 有账号即铺轴；内容按可见窗口加载，空时段显空轨道

  /** 跳转视图到某时间（停止跟随）：加载目标前后一个 step 的完整窗口（含该时段回复/互动），再滚到目标。 */
  async function jumpToTime(t: number): Promise<void> {
    setFollowing(false);
    const s = loadStepMs();
    lastLoadFromRef.current = t - s; // 记为已加载窗口，避免落定后又重复加载
    lastLoadToRef.current = t + s;
    await loadWindow(t - s, t + s);
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

  // axisFrom 左扩（减小）→ 所有 x 右移；非跟随且非跳转中时补偿 scrollLeft 保持视图不跳。
  useLayoutEffect(() => {
    const el = tlRef.current;
    const prev = prevAxisFromRef.current;
    if (el && prev != null && axisFrom != null && axisFrom < prev && !following && pendingJumpRef.current == null) {
      el.scrollLeft += ((prev - axisFrom) / 60_000) * ppmRef.current;
    }
    prevAxisFromRef.current = axisFrom;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axisFrom]);

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
      if (e.ctrlKey) {
        // Ctrl+滚轮：缩放
        e.preventDefault();
        setPxPerMin((p) => clamp(+(p * (e.deltaY < 0 ? 1.12 : 1 / 1.12)).toFixed(2), MIN_PPM, MAX_PPM));
        return;
      }
      if (e.altKey) {
        // Alt+滚轮：横向滚动（行模式换算成像素）
        e.preventDefault();
        const d = e.deltaY !== 0 ? e.deltaY : e.deltaX;
        el.scrollLeft += e.deltaMode === 1 ? d * 16 : d;
      }
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
    const userScrolled = Math.abs(el.scrollLeft - expectedLeftRef.current) > 3;
    if (userScrolled) setFollowing(false);
    setScrollX(el.scrollLeft);
    // 用户滚动/拖动滚动条到任意位置后，按可见窗口取数（含该时段历史互动）。程序性滚动不触发。
    if (userScrolled) {
      scheduleVisibleLoad();
      // 拖到左边缘：把横轴左界再往更早扩，使能继续向更早拖滚。
      if (el.scrollLeft < AXIS_EDGE_PX) setAxisFrom((a) => (a == null ? a : a - AXIS_EXTEND));
    }
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
        <span className="text-(--dim)">
          {worldId ?? '—'} · {blocks.length} 块{laneFilter ? ` · 轨道 ${lanes.length}/${allLanes.length}` : ''}
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
        <span className="ml-auto flex items-center gap-1.5 text-(--dim)" title="缩放（时间轴内 Ctrl+滚轮缩放、Alt+滚轮横向滚动）">
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
      {!error && !ready && (
        <p className="px-3 py-4 text-(--dim) text-sm">该世界还没有账号。建号后，其帖子与互动会在此按时间排布。</p>
      )}
      {ready && (
        <div className="flex flex-1 min-h-0">
          {/* 左：轨道管理面板（常驻；搜索 + 多选只看选中账号的轨道，可扩展到大量账号） */}
          <div className="shrink-0 flex flex-col border-r border-(--border) bg-(--panel2)" style={{ width: ROSTER_W }}>
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-(--border) text-xs font-semibold text-(--dim)">
              <span>轨道</span>
              <span><span className="text-(--blue)">{lanes.length}</span>/{allLanes.length}</span>
              <button onClick={() => setLaneFilter(null)} className="ml-auto text-(--blue) hover:underline cursor-pointer" title="显示全部账号">
                全选
              </button>
              <button onClick={() => setLaneFilter(new Set())} className="text-(--dim) hover:underline cursor-pointer" title="清空选择">
                清空
              </button>
            </div>
            <div className="px-2 py-1.5 border-b border-(--border)">
              <div className="flex items-center gap-1.5 bg-(--panel) border border-(--border) rounded-md px-2 py-1">
                <i className="ri-search-line text-(--dim)" />
                <input
                  type="text"
                  value={laneSearch}
                  onChange={(e) => setLaneSearch(e.target.value)}
                  placeholder="筛选账号…"
                  spellCheck={false}
                  className="flex-1 min-w-0 bg-transparent outline-none text-xs"
                />
                {laneSearch && (
                  <button onClick={() => setLaneSearch('')} className="text-(--dim) hover:text-(--text) cursor-pointer" title="清除搜索">
                    <i className="ri-close-line" />
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {manager.active.map((l) => (
                <LaneRow key={l} handle={l} name={nameOf(l)} on={isLaneOn(l)} onToggle={() => toggleLane(l)} />
              ))}
              {manager.inactive.length > 0 && (
                <>
                  <button
                    onClick={() => setShowInactive((v) => !v)}
                    className="flex items-center gap-1.5 w-full px-3 py-1.5 text-left text-[11px] text-(--dim) bg-(--panel) border-y border-[#15171b] hover:text-(--text) cursor-pointer"
                  >
                    <i className={showInactive ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
                    未活跃账号 {manager.inactive.length}
                  </button>
                  {showInactive &&
                    manager.inactive.map((l) => (
                      <LaneRow key={l} handle={l} name={nameOf(l)} on={isLaneOn(l)} onToggle={() => toggleLane(l)} muted />
                    ))}
                </>
              )}
              {manager.active.length === 0 && manager.inactive.length === 0 && (
                <p className="px-3 py-3 text-(--dim) text-[11px]">无匹配账号。</p>
              )}
            </div>
          </div>

          {/* 右：时间轴画布；无可见轨道（全部取消）时给提示 */}
          {lanes.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-4 text-(--dim) text-sm text-center">
              已隐藏全部轨道——在左侧勾选要查看的账号，或点「全选」。
            </div>
          ) : (
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
          )}
        </div>
      )}
    </div>
  );
}

/** 轨道管理面板的一行账号：勾选框 + 头像 + 昵称/@handle，点击切换该账号轨道是否显示。 */
function LaneRow({
  handle,
  name,
  on,
  onToggle,
  muted,
}: {
  handle: string;
  name: string;
  on: boolean;
  onToggle: () => void;
  muted?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-2 w-full px-3 py-1.5 text-left border-b border-[#15171b] hover:bg-[#1a1d22] cursor-pointer ${
        on ? '' : 'opacity-45'
      }`}
      title={on ? '点击隐藏此账号轨道' : '点击显示此账号轨道'}
    >
      <i className={on ? 'ri-checkbox-fill text-(--blue)' : 'ri-checkbox-blank-line text-(--dim)'} />
      <Avatar handle={handle} name={name} size={22} />
      <div className="min-w-0 leading-tight">
        <div className={`truncate text-xs ${muted ? 'text-(--dim)' : 'font-semibold'}`}>{name}</div>
        <div className="text-(--dim) text-[11px] truncate">@{handle}</div>
      </div>
    </button>
  );
}
