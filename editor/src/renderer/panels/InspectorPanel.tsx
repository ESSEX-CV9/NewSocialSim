import type { IDockviewPanelProps } from 'dockview';
import type { StoredSimTraceEvent } from '@socialsim/shared';
import { useSelectedTrace, setSelectedTrace } from '../state/selection.js';
import { ACTION_LABEL, formatSimTime } from './trace-meta.js';
import { Avatar } from './Avatar.js';

/**
 * 检视器：展示当前选中对象的详情（样式对齐 docs/editor-mockup.html 的 inspector）。
 * 当前承载时间轴选中轨迹事件的"为什么这么做"。跨面板选中态走 selection store，可自由停靠。
 * 帖文预览卡 / 池·语法·片段等需回拉真实数据，留待后续轮次。
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

  const pill = shapePill(selected);

  return (
    <div className="text-xs text-(--text) overflow-y-auto h-full">
      {/* 头部：形态药丸 + 标题 */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-(--border)">
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md text-white" style={{ background: pill.color }}>
          {pill.label}
        </span>
        <b className="text-[13px]">轨迹 #{selected.id}</b>
        <button
          onClick={() => setSelectedTrace(null)}
          className="ml-auto text-(--dim) hover:text-(--text) cursor-pointer"
          title="清除选中"
        >
          <i className="ri-close-line" />
        </button>
      </div>

      <Field k="作者">
        <span className="flex items-center gap-1.5">
          <Avatar handle={selected.entity} size={16} />
          {selected.entity}
        </span>
      </Field>
      <Field k="模拟时间"><span className="font-mono">{formatSimTime(selected.simTime)}</span></Field>
      <Field k="动作">{ACTION_LABEL[selected.action]} · {selected.action}</Field>
      <Field k="形态 shape">{selected.shape ?? '—'}</Field>
      <Field k="活动状态">{selected.activityState ?? '—'}</Field>
      <Field k="意图 intent">{selected.intent ?? '—'}</Field>
      <Field k="池 poolId"><span className="font-mono">{selected.poolId ?? '—'}</span></Field>
      <Field k="条目 entryId"><span className="font-mono">{selected.entryId ?? '—'}</span></Field>
      <Field k="配图">{selected.mediaAttached ? '是' : '否'}</Field>
      <Field k="目标帖"><span className="font-mono">{selected.targetPostId ?? '—'}</span></Field>
      <Field k="现实时间"><span className="font-mono">{formatSimTime(selected.at)}</span></Field>

      {/* 为什么：有理由记录才显示 */}
      {selected.mediaReason && (
        <div className="mx-3 my-2.5 px-2.5 py-2 rounded-lg text-[12px]" style={{ background: '#10130f', border: '1px solid #25351c', color: '#a8c79a' }}>
          <span className="font-semibold">为什么配图：</span>{selected.mediaReason}
        </div>
      )}
    </div>
  );
}

/** 形态/动作 → 药丸标签与配色。 */
function shapePill(e: StoredSimTraceEvent): { label: string; color: string } {
  switch (e.shape) {
    case 'standalone':
      return { label: '顶层帖', color: 'var(--blue)' };
    case 'reply':
      return { label: '回复', color: 'var(--green)' };
    case 'quote':
      return { label: '引用', color: 'var(--amber)' };
    default:
      return { label: ACTION_LABEL[e.action], color: '#3a3f46' };
  }
}

/** mockup .field：74px 标签 + 值，下边线分隔。 */
function Field({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[74px_1fr] gap-2 px-3 py-1.5 border-b border-[#15171b]">
      <span className="text-(--dim)">{k}</span>
      <span className="min-w-0 wrap-break-word">{children}</span>
    </div>
  );
}
