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
 *
 * 有界窗口模型：顶部三件套「左偏移｜中轴时间｜右偏移」+ 单位下拉（分/时/天）定义可见时间范围
 * = [中轴 − 左, 中轴 + 右]。横轴/滚动条**恰好覆盖这段**，滚到头即窗口边缘——想看更早/更远，
 * 改中轴或拉大左右偏移。改边界/单位/中轴时自动把缩放调到「整窗铺满视口」，再 Ctrl+滚轮放大看细节。
 * 中轴只有点「回到现在」后才跟随流速前进，否则冻结在当前值。
 * 取数走编辑器后端单一聚合端点 GET /api/timeline，按当前窗口区间加载（含该时段全部回复/互动）。
 */

const RULER_H = 26;
const ROSTER_W = 200;
const LABEL_W = 96;
const LANE_DIV = '#26292e';
const SUBROW_H = 26;
const LANE_PAD = 8;
const LANE_MIN_H = 46;
const MIN_PPM = 0.2; // 像素/分钟下限：足够低，使宽窗口（如数天）也能整窗铺满视口
const MAX_PPM = 120;
const H_MIN_THUMB = 44; // 自定义横向滚动条拉手最小宽度（px），高缩放下也不会缩成小点
const VBUF = 400;
const POLL_WORLD_MS = 3000;
const TICK_MS = 250;
const FEED_LIMIT = 50;
const DAY_MS = 86_400_000;
const UNIT_MS: Record<Unit, number> = { m: 60_000, h: 3_600_000, d: DAY_MS };
const SPAN_DEFAULT = 12; // 左右默认各 12（单位 h）→ 默认看「现在」前后各 12 小时、共 24h 窗口
const NICE_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 240, 360, 720, 1440];

type Unit = 'm' | 'h' | 'd';
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

/**
 * 计算每个块的子行堆叠与各 lane 高度。**与传入 origin 无关**——堆叠只看块间相对间隔（取决于 pxPerMin
 * 与块集），origin 的平移对所有块一致、不改变重叠关系。故传一个稳定 origin（minTime）即可让 memo
 * 在「跟随」时不随每 tick 的窗口滑动重算（渲染时的绝对 x 另用实时 origin 算）。
 */
function computeLayout(blocks: TimelineBlock[], lanes: string[], stackOrigin: number, pxPerMin: number): Layout {
  const ax = (t: number) => ((t - stackOrigin) / 60_000) * pxPerMin;
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
  // 中轴时间：following 时用实时 now（跟随流速前进）；冻结时用此固定值。
  const [centerMs, setCenterMs] = useState<number | null>(null);
  const [spanLeft, setSpanLeft] = useState(SPAN_DEFAULT); // 左偏移（单位 unit）
  const [spanRight, setSpanRight] = useState(SPAN_DEFAULT); // 右偏移（单位 unit）
  const [unit, setUnit] = useState<Unit>('h');
  // 轨道筛选（T.6）：null = 全部账号；非空集 = 只看选中账号的轨道（纯视图过滤，数据已在内存）。
  const [laneFilter, setLaneFilter] = useState<Set<string> | null>(null);
  const [laneSearch, setLaneSearch] = useState(''); // 轨道管理面板的账号搜索词（昵称/@handle）
  const [showInactive, setShowInactive] = useState(false); // 是否展开"未活跃账号"分组
  const worldRef = useRef<string | null>(null);
  const anchorRef = useRef<Anchor | null>(null);
  const tlRef = useRef<HTMLDivElement | null>(null);
  const expectedLeftRef = useRef(0);
  const postIdsRef = useRef<Set<number>>(new Set());
  const actKeysRef = useRef<Set<string>>(new Set());
  const coverToRef = useRef<number | null>(null); // 已加载到的最新时间（跟随时轮询据此向"现在"续接）
  const originSimRef = useRef(0); // 当前实时 origin（时间↔x 映射），供滚动/缩放时由像素反推时间
  const ppmRef = useRef(pxPerMin);
  ppmRef.current = pxPerMin;
  const viewWRef = useRef(viewW); // 供陈旧闭包读到当前视宽
  viewWRef.current = viewW;
  const followingRef = useRef(following);
  followingRef.current = following;
  const centerMsRef = useRef(centerMs);
  centerMsRef.current = centerMs;
  const spanLeftRef = useRef(spanLeft);
  spanLeftRef.current = spanLeft;
  const spanRightRef = useRef(spanRight);
  spanRightRef.current = spanRight;
  const unitRef = useRef(unit);
  unitRef.current = unit;
  const readyRef = useRef(false);
  const zoomAnchorRef = useRef<{ t: number; px: number } | null>(null); // 缩放后把该时间对齐回该像素，使缩放点不漂
  const [, rerender] = useState(0);

  const backend = window.editor.backendUrl;

  const leftMsOf = (): number => spanLeftRef.current * UNIT_MS[unitRef.current];
  const rightMsOf = (): number => spanRightRef.current * UNIT_MS[unitRef.current];

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

  /** 加载某时间窗口的完整内容（顶层帖 + 回复 + 互动 + roster），并入既有数据（按 id/key 去重）。 */
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
  /** 加载以 center 为中轴的当前窗口 [center−左, center+右] 的内容。 */
  function loadAround(center: number): void {
    void loadWindow(center - leftMsOf(), center + rightMsOf());
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

  /** 把缩放调到「整窗恰好铺满视口」：pxPerMin = 视宽 / 窗口分钟数（夹到 [MIN,MAX]）。 */
  function fitZoom(): void {
    const mins = (leftMsOf() + rightMsOf()) / 60_000;
    if (mins <= 0) return;
    setPxPerMin(clamp(+(viewWRef.current / mins).toFixed(3), MIN_PPM, MAX_PPM));
  }

  /** 缩放（滑块/Ctrl+滚轮共用）：记下锚点像素处对应的时间，缩放后把它对齐回原像素，缩放点不漂（②）。 */
  function applyZoom(next: number, anchorPx?: number): void {
    const el = tlRef.current;
    if (el) {
      const px = anchorPx ?? el.clientWidth / 2; // 默认锚视口中心
      const t = originSimRef.current + ((el.scrollLeft - LABEL_W + px) / Math.max(0.0001, ppmRef.current)) * 60_000;
      zoomAnchorRef.current = { t, px };
    }
    setPxPerMin(clamp(+next.toFixed(3), MIN_PPM, MAX_PPM));
  }

  /** 把某时间滚到视口中央（跳转/冻结态下改边界后用）。 */
  function scrollCenter(t: number): void {
    requestAnimationFrame(() => {
      const el = tlRef.current;
      if (!el) return;
      const x = ((t - originSimRef.current) / 60_000) * ppmRef.current;
      const target = clamp(LABEL_W + x - el.clientWidth / 2, 0, Math.max(0, el.scrollWidth - el.clientWidth));
      el.scrollLeft = target;
      expectedLeftRef.current = target;
      setScrollX(target);
    });
  }

  /** 初始/刷新：取最新实际内容定位——世界时钟可能远超内容（模拟器停了时钟仍走），
   *  内容明显落后于"现在"时把中轴冻结到最新内容、停跟随，否则跟随现在。 */
  async function loadInitial(): Promise<void> {
    postIdsRef.current = new Set();
    actKeysRef.current = new Set();
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
      coverToRef.current = now; // 跟随时从 now 续接新内容
      const idle = now - latest > 30 * 60_000; // 时钟领先内容超 30 分钟：内容落后，冻结到最新内容
      const center = idle ? latest : now;
      setFollowing(!idle);
      setCenterMs(idle ? latest : null);
      fitZoom();
      loadAround(center);
      if (idle) scrollCenter(center); // 跟随分支由 following-effect 滚到 now
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  // 轮询活动世界：拾取时钟锚点；切世界则重载，否则向"现在"续接新内容。
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
          await loadInitial();
        } else if (alive && followingRef.current) {
          // 跟随时把覆盖区间往"现在"扩，拉入新产生的内容。
          const now = simNow();
          const from = coverToRef.current ?? now - rightMsOf();
          if (now - from >= 1000) {
            coverToRef.current = now;
            await loadWindow(from, now);
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
  // 实际渲染的轨道：有筛选则取交集（保留 allLanes 顺序）。
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

  function simNow(): number {
    const a = anchorRef.current;
    if (!a) return maxTime;
    return a.paused ? a.simAnchorMs : a.simAnchorMs + (Date.now() - a.realAnchorMs) * a.scale;
  }
  const now = simNow();
  const ready = allLanes.length > 0; // 有账号即铺轴；空时段显空轨道
  readyRef.current = ready;

  // 当前窗口与坐标系：中轴 = 跟随时 now，否则冻结值；窗口 = [中轴−左, 中轴+右]。
  const center = following ? now : centerMs ?? now;
  const windowFrom = center - spanLeft * UNIT_MS[unit];
  const windowTo = center + spanRight * UNIT_MS[unit];
  const originSim = windowFrom;
  originSimRef.current = originSim;
  const ax = (t: number) => ((t - originSim) / 60_000) * pxPerMin;
  // 堆叠用稳定 origin（minTime）算（与 origin 无关，见 computeLayout），避免跟随时每 tick 重算。
  const layout = useMemo(() => computeLayout(blocks, lanes, minTime, pxPerMin), [blocks, lanes, minTime, pxPerMin]);
  // 轨道宽 = 窗口像素宽，但至少铺满视口（③：轨道分割线不会在右侧断掉）。
  const windowPx = ((windowTo - windowFrom) / 60_000) * pxPerMin;
  const trackWidth = Math.max(windowPx, viewW);

  // 自定义横向滚动条：原生拉手在高缩放下会缩成一个小点（尺寸 ∝ 视口/内容，对缩放呈双曲），
  // 故隐藏原生横向条、自绘一条带最小拉手宽度的条（拉手永不缩成点）。
  const scrollW = LABEL_W + trackWidth;
  const maxScrollX = Math.max(0, scrollW - viewW);
  const hasHScroll = maxScrollX > 1;
  const hThumbW = hasHScroll ? Math.max(H_MIN_THUMB, (viewW / scrollW) * viewW) : viewW;
  const hThumbLeft = hasHScroll ? (scrollX / maxScrollX) * (viewW - hThumbW) : 0;
  /** 把拉手左缘像素映射回 scrollLeft 并应用。 */
  function setScrollFromThumb(thumbLeftPx: number): void {
    const el = tlRef.current;
    if (!el) return;
    const denom = Math.max(1, viewW - hThumbW);
    el.scrollLeft = clamp((thumbLeftPx / denom) * maxScrollX, 0, maxScrollX);
  }
  function onHThumbDown(e: React.MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startLeft = hThumbLeft;
    const onMove = (ev: MouseEvent) => setScrollFromThumb(startLeft + (ev.clientX - startX));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
  function onHTrackDown(e: React.MouseEvent): void {
    const rect = e.currentTarget.getBoundingClientRect();
    setScrollFromThumb(clamp(e.clientX - rect.left - hThumbW / 2, 0, viewW - hThumbW));
  }

  /** 跳转中轴到某时间（冻结、停跟随）：自动铺满 + 加载该窗口 + 居中。 */
  function jumpToCenter(t: number): void {
    setFollowing(false);
    setCenterMs(t);
    fitZoom();
    loadAround(t);
    scrollCenter(t);
  }
  function commitTimeEdit(): void {
    if (editingTime != null) {
      const t = parseSimTime(editingTime);
      if (t != null) jumpToCenter(t);
    }
    setEditingTime(null);
  }
  /** 回到现在：恢复跟随、铺满、加载现在窗口（following-effect 负责把播放头居中）。 */
  function backToNow(): void {
    setFollowing(true);
    setCenterMs(null);
    fitZoom();
    const n = simNow();
    coverToRef.current = n;
    loadAround(n);
  }
  /** 改左/右偏移或单位：保持当前中轴，重铺满 + 重载窗口 + 居中。 */
  function changeSpan(side: 'left' | 'right', raw: string): void {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n < 0) return;
    if (side === 'left') setSpanLeft(n);
    else setSpanRight(n);
  }
  // 左右偏移 / 单位变化后：自动铺满 + 重载 + 居中（用最新值，故放 effect 里）。
  useEffect(() => {
    if (!readyRef.current) return;
    fitZoom();
    const c = followingRef.current ? simNow() : centerMsRef.current ?? simNow();
    loadAround(c);
    if (!followingRef.current) scrollCenter(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spanLeft, spanRight, unit]);

  // 处理缩放锚点：pxPerMin 变化后把锚点时间对齐回锚点像素（②，缩放点不漂）。
  useLayoutEffect(() => {
    const el = tlRef.current;
    const anchor = zoomAnchorRef.current;
    if (el && anchor) {
      const x = ((anchor.t - originSimRef.current) / 60_000) * ppmRef.current;
      const target = clamp(LABEL_W + x - anchor.px, 0, Math.max(0, el.scrollWidth - el.clientWidth));
      el.scrollLeft = target;
      expectedLeftRef.current = target;
      setScrollX(target);
    }
    zoomAnchorRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pxPerMin]);

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
        // Ctrl+滚轮：缩放，锚到光标位置（该处时间缩放前后不动）。
        e.preventDefault();
        const px = e.clientX - el.getBoundingClientRect().left;
        applyZoom(ppmRef.current * (e.deltaY < 0 ? 1.12 : 1 / 1.12), px);
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

  // 跟随时把播放头（现在）保持居中——窗口随时钟滑动、内容在固定播放头下左移。
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
    if (userScrolled && followingRef.current) {
      // 用户手动滚动：停跟随、把中轴冻结在当前 now，窗口停在原地（数据已在窗口内，无需再取）。
      setFollowing(false);
      setCenterMs(simNow());
    }
    setScrollX(el.scrollLeft);
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
      if (ms < windowFrom || ms > windowTo) continue; // 只在窗口内出刻度——否则窗口外的绝对刻度会撑大
      // scrollWidth、抬高 gxMax、再生成更靠右的刻度……自我喂养致「往右无限前进」（#1 真凶）。
      const withDate = stepMin >= 1440 || Math.abs(ms - now) > DAY_MS;
      ticks.push({ x: ax(ms), label: formatTick(ms, withDate) });
    }
  }

  const nowX = ax(now);
  // 「现在」标记只在窗口内显示——否则冻结到过去时，实时播放头会随时钟一路右移、
  // 撑大滚动区使「往右无限前进」（#1）。窗口外（如冻结于过去）就不画它。
  const showNow = now >= windowFrom && now <= windowTo;
  const visible = blocks.filter((b) => {
    if (b.time < windowFrom || b.time > windowTo) return false; // 窗口外不渲染，防溢出撑大滚动区
    const x = ax(b.time);
    return x >= gxMin - 240 && x <= gxMax;
  });

  // 中轴时间框显示值：编辑中用草稿，否则显示当前中轴（跟随时即 now，实时走）。
  const centerLabel = formatSimTime(center);

  const numInput = 'w-12 bg-(--chip) border border-(--border) rounded px-1 py-0.5 text-center tabular-nums outline-none focus:border-(--blue)';

  return (
    <div className="flex flex-col h-full text-(--text)">
      {/* 工具条 */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-(--border) text-xs">
        <i className="ri-time-line text-(--blue)" />
        <span className="font-semibold">时间轴</span>

        {/* 左偏移 ｜ 中轴时间 ｜ 右偏移 ｜ 单位 */}
        <span className="text-(--dim) ml-1">窗口</span>
        <input
          type="number"
          min={0}
          value={spanLeft}
          onChange={(e) => changeSpan('left', e.target.value)}
          title="左边界：中轴往前看多久"
          className={numInput}
        />
        <i className="ri-arrow-left-line text-(--dim)" />
        <input
          type="text"
          spellCheck={false}
          value={editingTime ?? centerLabel}
          onFocus={() => setEditingTime(centerLabel)}
          onChange={(e) => setEditingTime(e.target.value)}
          onBlur={commitTimeEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitTimeEdit();
              e.currentTarget.blur();
            }
          }}
          title="中轴时间（格式 2026-06-17 14:30:00，世界模拟时间非系统时间）；改它即跳转窗口"
          className="w-36 bg-(--chip) border border-(--border) rounded px-1.5 py-0.5 text-(--amber) font-mono tabular-nums cursor-text focus:border-(--amber) outline-none"
        />
        <i className="ri-arrow-right-line text-(--dim)" />
        <input
          type="number"
          min={0}
          value={spanRight}
          onChange={(e) => changeSpan('right', e.target.value)}
          title="右边界：中轴往后看多久"
          className={numInput}
        />
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value as Unit)}
          title="边界单位"
          className="bg-(--chip) border border-(--border) rounded px-1 py-0.5 text-(--text) outline-none cursor-pointer"
        >
          <option value="m">分</option>
          <option value="h">时</option>
          <option value="d">天</option>
        </select>

        <span className="text-(--dim) ml-1">
          {worldId ?? '—'} · {blocks.length} 块{laneFilter ? ` · 轨道 ${lanes.length}/${allLanes.length}` : ''}
        </span>
        {!following && (
          <button
            onClick={backToNow}
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
            onChange={(e) => applyZoom(Number(e.target.value))}
            style={{ accentColor: 'var(--blue)' }}
            className="w-24 cursor-pointer"
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
          <div className="flex-1 flex flex-col min-w-0">
          {/* 横向用自定义滚动条（下方）：隐藏原生横向条，纵向保留原生 */}
          <div ref={tlRef} onScroll={onScroll} className="tl-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
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

                {showNow && (
                  <div
                    className="absolute top-0 bottom-0 pointer-events-none z-10"
                    style={{ left: nowX, width: 2, background: 'var(--amber)', opacity: 0.75, transform: 'translateX(-1px)' }}
                  >
                    <span className="absolute top-0.5 left-1 text-[10px] font-semibold text-(--amber) whitespace-nowrap">现在</span>
                  </div>
                )}

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
          {/* 自定义横向滚动条：拉手带最小宽度，高缩放下也不缩成点 */}
          {hasHScroll && (
            <div
              onMouseDown={onHTrackDown}
              style={{ width: viewW }}
              className="relative h-3 shrink-0 bg-(--panel2) border-t border-(--border) cursor-pointer select-none"
            >
              <div
                onMouseDown={onHThumbDown}
                style={{ left: hThumbLeft, width: hThumbW }}
                className="absolute top-0.5 bottom-0.5 rounded bg-[#454c55] hover:bg-[#58616c] cursor-grab active:cursor-grabbing"
              />
            </div>
          )}
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
