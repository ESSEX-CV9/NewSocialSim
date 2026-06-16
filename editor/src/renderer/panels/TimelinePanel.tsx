import { useEffect, useMemo, useRef, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import type { StoredSimTraceEvent } from '@socialsim/shared';
import { useSelectedTrace, setSelectedTrace } from '../state/selection.js';
import { ACTION_COLOR, ACTION_LABEL, formatSimTime } from './trace-meta.js';

/**
 * 时间轴面板（Premiere 范式，见 docs/m5-design.md）：横轴为时间、纵轴每行一个账号。
 * 以当前模拟时间为分界的金色播放头居中——左侧已发生、右侧待发生——随模拟时钟向左滚动。
 * 点选块写入全局选中态，详情由独立检视器面板展示。经 GET /api/trace 载入 + SSE 实时长块。
 */

const LANE_H = 30; // 每条账号轨道高度（px）
const BLOCK_W = 9; // 事件块宽度（px）
const RULER_H = 22; // 顶部时间标尺高度（px）
const ZOOMS = [2, 6, 18, 60]; // px / 模拟分钟
const POLL_WORLD_MS = 3000;
const TICK_MS = 250; // 播放头随时钟推进的重绘节拍
/** 网格步长候选（分钟），挑最接近 ~90px 间距的"整"值。 */
const NICE_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 240, 360, 720, 1440];

/** 活动世界时钟锚点：轮询拾取，本地按流速推算当前模拟时间。 */
interface Anchor {
  scale: number;
  paused: boolean;
  simAnchorMs: number;
  realAnchorMs: number;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
/** 网格刻度短标签：HH:MM；跨日步长再带日期。 */
function formatTick(ms: number, withDate: boolean): string {
  const d = new Date(ms);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return withDate ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}` : hm;
}
function niceStepMin(pxPerMin: number): number {
  const target = 90 / pxPerMin;
  return NICE_STEPS.find((n) => n >= target) ?? NICE_STEPS[NICE_STEPS.length - 1]!;
}

export function TimelinePanel(_props: IDockviewPanelProps) {
  const [events, setEvents] = useState<StoredSimTraceEvent[]>([]);
  const [worldId, setWorldId] = useState<string | null>(null);
  const selected = useSelectedTrace();
  const [error, setError] = useState<string | null>(null);
  const [pxPerMin, setPxPerMin] = useState(6);
  const worldRef = useRef<string | null>(null);
  const anchorRef = useRef<Anchor | null>(null);
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

  // 轮询活动世界：拾取时钟锚点（流速/暂停/当前模拟时间），并在切世界时重载轨迹。
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

  const { lanes, maxSim } = useMemo(() => {
    const ls = [...new Set(events.map((e) => e.entity))].sort();
    let hi = 0;
    for (const e of events) if (e.simTime > hi) hi = e.simTime;
    return { lanes: ls, maxSim: hi };
  }, [events]);
  const laneIndex = useMemo(() => new Map(lanes.map((l, i) => [l, i])), [lanes]);

  // 当前模拟时间（播放头）：有锚点按流速推算；无锚点回落到最新事件时刻。
  function simNow(): number {
    const a = anchorRef.current;
    if (!a) return maxSim;
    return a.paused ? a.simAnchorMs : a.simAnchorMs + (Date.now() - a.realAnchorMs) * a.scale;
  }
  const now = simNow();

  // 网格刻度：以 now 为中心，每 stepMin 一条；px/分钟决定步长与覆盖范围。
  const stepMin = niceStepMin(pxPerMin);
  const stepPx = stepMin * pxPerMin;
  const gridN = Math.ceil(2500 / stepPx) + 1;
  const withDate = stepMin >= 1440;
  // 仅渲染播放头附近一段时间窗内的块，避免一次铺上千 DOM。
  const halfMinWindow = 3000 / pxPerMin;
  const visible = events.filter((e) => Math.abs(e.simTime - now) / 60_000 <= halfMinWindow);

  const offPx = (simTime: number): number => ((simTime - now) / 60_000) * pxPerMin;

  return (
    <div className="flex flex-col h-full text-(--text)">
      {/* 工具条 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-(--border) text-xs">
        <i className="ri-time-line text-(--blue)" />
        <span className="font-semibold">时间轴</span>
        <span className="text-(--dim)">{worldId ?? '—'} · {events.length} 条 · {lanes.length} 账号</span>
        <span className="ml-2 font-mono tabular-nums text-(--amber)" title="当前模拟时间（播放头）">
          {formatSimTime(now)}
        </span>
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

      {/* 轨道区：左账号标签列 + 右播放头视口 */}
      {events.length > 0 && (
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="flex min-h-full">
            {/* 账号标签列 */}
            <div className="sticky left-0 z-20 bg-(--panel2) border-r border-(--border) shrink-0">
              <div style={{ height: RULER_H }} className="border-b border-(--border)" />
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

            {/* 播放头视口：now 居中，块按相对 now 的偏移定位（calc(50% + offset)） */}
            <div className="relative flex-1 overflow-hidden">
              {/* 网格竖线 + 刻度标签 */}
              {Array.from({ length: gridN * 2 + 1 }, (_, i) => {
                const k = i - gridN;
                if (k === 0) return null; // 中心由金色播放头画
                const ms = now + k * stepMin * 60_000;
                return (
                  <div
                    key={k}
                    className="absolute top-0 bottom-0 border-l border-[#1b1e22]"
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
                <div key={l} style={{ height: LANE_H }} className="border-b border-[#15171b]" />
              ))}

              {/* 金色播放头（当前模拟时间分界） */}
              <div
                className="absolute top-0 bottom-0 pointer-events-none z-10"
                style={{ left: '50%', width: 2, background: 'var(--amber)', transform: 'translateX(-1px)' }}
              >
                <span className="absolute top-0 left-1 text-[10px] font-semibold text-(--amber) whitespace-nowrap">
                  现在
                </span>
              </div>

              {/* 事件块（仅渲染播放头附近时间窗） */}
              {visible.map((e) => {
                const li = laneIndex.get(e.entity) ?? 0;
                const isSel = selected?.id === e.id;
                return (
                  <button
                    key={e.id}
                    onClick={() => setSelectedTrace(e)}
                    title={`${e.entity} · ${ACTION_LABEL[e.action]} · ${formatSimTime(e.simTime)}`}
                    style={{
                      position: 'absolute',
                      left: `calc(50% + ${offPx(e.simTime)}px)`,
                      top: RULER_H + li * LANE_H + 5,
                      width: BLOCK_W,
                      height: LANE_H - 12,
                      transform: 'translateX(-50%)',
                      background: ACTION_COLOR[e.action],
                      outline: isSel ? '2px solid var(--text)' : 'none',
                      opacity: isSel ? 1 : 0.85,
                    }}
                    className="rounded-sm cursor-pointer hover:opacity-100 z-10"
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
