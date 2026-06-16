import type { IDockviewPanelProps } from 'dockview';
import { useSelectedTrace, setSelectedTrace } from '../state/selection.js';
import { ACTION_COLOR, ACTION_LABEL, formatSimTime } from './trace-meta.js';

/**
 * 检视器：展示当前选中对象的详情。当前承载时间轴选中的轨迹事件的"为什么这么做"。
 * 跨面板选中态走 selection store，故可与时间轴分属不同窗格、自由停靠。
 */
export function InspectorPanel(_props: IDockviewPanelProps) {
  const selected = useSelectedTrace();

  if (!selected) {
    return (
      <div className="p-4 text-sm text-(--dim)">
        <p>在时间轴点选一个事件块，这里显示它的决策详情。</p>
      </div>
    );
  }

  return (
    <div className="p-3 text-xs text-(--text)">
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: ACTION_COLOR[selected.action] }} />
        <span className="font-semibold text-sm">{selected.entity}</span>
        <span className="text-(--dim)">{ACTION_LABEL[selected.action]}</span>
        <button
          onClick={() => setSelectedTrace(null)}
          className="ml-auto text-(--dim) hover:text-(--text) cursor-pointer"
          title="清除选中"
        >
          <i className="ri-close-line" />
        </button>
      </div>
      <div className="flex flex-col gap-0.5">
        <Kv k="模拟时间" v={formatSimTime(selected.simTime)} />
        <Kv k="形态 shape" v={selected.shape ?? '—'} />
        <Kv k="意图 intent" v={selected.intent ?? '—'} />
        <Kv k="活动态" v={selected.activityState ?? '—'} />
        <Kv k="池 poolId" v={selected.poolId ?? '—'} />
        <Kv k="条目 entryId" v={selected.entryId ?? '—'} />
        <Kv k="配图" v={selected.mediaAttached ? `是 · ${selected.mediaReason ?? ''}` : '否'} />
        <Kv k="目标帖" v={selected.targetPostId ?? '—'} />
        <Kv k="现实时间" v={formatSimTime(selected.at)} />
        <Kv k="事件 id" v={`#${selected.id}`} />
      </div>
    </div>
  );
}

function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 py-1 border-b border-[#15171b]">
      <span className="text-(--dim) shrink-0">{k}</span>
      <span className="font-mono truncate text-right">{v}</span>
    </div>
  );
}
