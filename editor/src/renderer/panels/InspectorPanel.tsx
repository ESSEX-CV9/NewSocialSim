import type { IDockviewPanelProps } from 'dockview';
import { useSelectedBlock, setSelectedBlock } from '../state/selection.js';
import type { TimelineBlock, PostBlock, TraceBlock } from './timeline-model.js';
import { ACTION_LABEL, formatSimTime } from './trace-meta.js';
import { Avatar } from './Avatar.js';

/**
 * 检视器：展示当前选中块的详情（样式对齐 docs/editor-mockup.html）。
 * 帖子块 → 帖子预览（作者/正文/计数/媒体/时间）；互动块 → 决策轨迹的"为什么"。
 * 跨面板选中态走 selection store，可与时间轴分属不同窗格、自由停靠。
 */
export function InspectorPanel(_props: IDockviewPanelProps) {
  const block = useSelectedBlock();

  if (!block) {
    return (
      <div className="p-4 text-sm text-(--dim)">
        <p>在时间轴点选一个块，这里显示它的详情。</p>
      </div>
    );
  }

  const pill = blockPill(block);
  return (
    <div className="text-xs text-(--text) overflow-y-auto h-full">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-(--border)">
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md text-white" style={{ background: pill.color }}>
          {pill.label}
        </span>
        <b className="text-[13px]">{block.kind === 'post' ? `帖子 #${block.post.id}` : `轨迹 #${block.event.id}`}</b>
        <button
          onClick={() => setSelectedBlock(null)}
          className="ml-auto text-(--dim) hover:text-(--text) cursor-pointer"
          title="清除选中"
        >
          <i className="ri-close-line" />
        </button>
      </div>
      {block.kind === 'post' ? <PostDetail block={block} /> : <TraceDetail block={block} />}
    </div>
  );
}

/** 帖子块详情：帖子预览卡 + 关键字段。 */
function PostDetail({ block }: { block: PostBlock }) {
  const p = block.post;
  return (
    <>
      <div className="m-3 px-3 py-2.5 rounded-xl bg-(--panel2) border border-(--border)">
        <div className="flex items-center gap-2">
          <Avatar handle={p.author.handle} name={p.author.displayName} size={22} />
          <span className="font-semibold truncate">{p.author.displayName}</span>
          <span className="text-(--dim) truncate">@{p.author.handle}</span>
        </div>
        <div className="mt-2 whitespace-pre-wrap wrap-break-word">{p.content || <span className="text-(--dim)">（无正文）</span>}</div>
        {p.media.length > 0 && (
          <div className="mt-2 text-(--dim)"><i className="ri-image-line" /> {p.media.length} 个媒体</div>
        )}
        <div className="mt-2 flex items-center gap-4 text-(--dim) text-[11px]">
          <span><i className="ri-heart-line" /> {p.likeCount}</span>
          <span><i className="ri-repeat-line" /> {p.repostCount}</span>
          <span><i className="ri-chat-1-line" /> {p.replyCount}</span>
          <span><i className="ri-double-quotes-l" /> {p.quoteCount}</span>
        </div>
      </div>
      <Field k="作者">{p.author.displayName} · @{p.author.handle}</Field>
      <Field k="发布时间"><span className="font-mono">{formatSimTime(p.createdAt)}</span></Field>
      <Field k="形态">{block.action === 'post' ? '顶层帖' : block.action === 'reply' ? '回复' : '引用'}</Field>
      {p.replyToId != null && <Field k="回复对象"><span className="font-mono">#{p.replyToId}</span></Field>}
      {p.quoteOfId != null && <Field k="引用对象"><span className="font-mono">#{p.quoteOfId}</span></Field>}
      <Field k="帖子 id"><span className="font-mono">#{p.id}</span></Field>
    </>
  );
}

/** 互动块详情：决策轨迹字段（赞/转/关注的"为什么"）。 */
function TraceDetail({ block }: { block: TraceBlock }) {
  const e = block.event;
  return (
    <>
      <Field k="账号">
        <span className="flex items-center gap-1.5"><Avatar handle={e.entity} size={16} />{e.entity}</span>
      </Field>
      <Field k="模拟时间"><span className="font-mono">{formatSimTime(e.simTime)}</span></Field>
      <Field k="动作">{ACTION_LABEL[e.action]} · {e.action}</Field>
      <Field k="活动状态">{e.activityState ?? '—'}</Field>
      <Field k="意图 intent">{e.intent ?? '—'}</Field>
      <Field k="目标帖"><span className="font-mono">{e.targetPostId ?? '—'}</span></Field>
      <Field k="现实时间"><span className="font-mono">{formatSimTime(e.at)}</span></Field>
      {e.mediaReason && (
        <div className="mx-3 my-2.5 px-2.5 py-2 rounded-lg text-[12px]" style={{ background: '#10130f', border: '1px solid #25351c', color: '#a8c79a' }}>
          <span className="font-semibold">为什么：</span>{e.mediaReason}
        </div>
      )}
    </>
  );
}

/** 块 → 头部药丸标签与配色。 */
function blockPill(b: TimelineBlock): { label: string; color: string } {
  if (b.kind === 'post') {
    if (b.action === 'reply') return { label: '回复', color: 'var(--green)' };
    if (b.action === 'quote') return { label: '引用', color: 'var(--amber)' };
    return { label: '顶层帖', color: 'var(--blue)' };
  }
  return { label: ACTION_LABEL[b.action], color: '#3a3f46' };
}

function Field({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[74px_1fr] gap-2 px-3 py-1.5 border-b border-[#15171b]">
      <span className="text-(--dim)">{k}</span>
      <span className="min-w-0 wrap-break-word">{children}</span>
    </div>
  );
}
