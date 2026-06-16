import type { IDockviewPanelProps } from 'dockview';
import type { PostView } from '@socialsim/shared';
import { useSelectedBlock, setSelectedBlock } from '../state/selection.js';
import type { TimelineBlock, PostBlock, RepostBlock } from './timeline-model.js';
import { formatSimTime } from './trace-meta.js';
import { Avatar } from './Avatar.js';

/**
 * 检视器：展示当前选中块的详情（样式对齐 docs/editor-mockup.html）。
 * 帖子块 → 帖子预览（作者/正文/计数/媒体/形态）；转发块 → 转发者 + 被转发原帖预览。
 * 决策轨迹"为什么"待 postId 合并后作为帖子块的增强字段接入。
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
        <b className="text-[13px]">帖子 #{block.post.id}</b>
        <button
          onClick={() => setSelectedBlock(null)}
          className="ml-auto text-(--dim) hover:text-(--text) cursor-pointer"
          title="清除选中"
        >
          <i className="ri-close-line" />
        </button>
      </div>
      {block.kind === 'post' ? <PostDetail block={block} /> : <RepostDetail block={block} />}
    </div>
  );
}

function PostDetail({ block }: { block: PostBlock }) {
  const p = block.post;
  return (
    <>
      <PostCard post={p} />
      <Field k="作者">{p.author.displayName} · @{p.author.handle}</Field>
      <Field k="发布时间"><span className="font-mono">{formatSimTime(block.time)}</span></Field>
      <Field k="形态">{block.action === 'post' ? '顶层帖' : block.action === 'reply' ? '回复' : '引用'}</Field>
      {p.replyToId != null && <Field k="回复对象"><span className="font-mono">#{p.replyToId}</span></Field>}
      {p.quoteOfId != null && <Field k="引用对象"><span className="font-mono">#{p.quoteOfId}</span></Field>}
      <Field k="帖子 id"><span className="font-mono">#{p.id}</span></Field>
    </>
  );
}

function RepostDetail({ block }: { block: RepostBlock }) {
  return (
    <>
      <div className="flex items-center gap-1.5 px-3 pt-3 text-(--dim)">
        <i className="ri-repeat-line" />
        <Avatar handle={block.by.handle} name={block.by.displayName} size={16} />
        <span className="text-(--text)">{block.by.displayName}</span> 转发了
      </div>
      <PostCard post={block.post} />
      <Field k="转发者">{block.by.displayName} · @{block.by.handle}</Field>
      <Field k="转发时间"><span className="font-mono">{formatSimTime(block.time)}</span></Field>
      <Field k="原帖作者">{block.post.author.displayName} · @{block.post.author.handle}</Field>
      <Field k="原帖 id"><span className="font-mono">#{block.post.id}</span></Field>
    </>
  );
}

/** 帖子预览卡（作者/正文/媒体/计数）。 */
function PostCard({ post: p }: { post: PostView }) {
  return (
    <div className="m-3 px-3 py-2.5 rounded-xl bg-(--panel2) border border-(--border)">
      <div className="flex items-center gap-2">
        <Avatar handle={p.author.handle} name={p.author.displayName} size={22} />
        <span className="font-semibold truncate">{p.author.displayName}</span>
        <span className="text-(--dim) truncate">@{p.author.handle}</span>
      </div>
      <div className="mt-2 whitespace-pre-wrap wrap-break-word">
        {p.content || <span className="text-(--dim)">（无正文）</span>}
      </div>
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
  );
}

function blockPill(b: TimelineBlock): { label: string; color: string } {
  if (b.kind === 'repost') return { label: '转发', color: '#3a3f46' };
  if (b.action === 'reply') return { label: '回复', color: 'var(--green)' };
  if (b.action === 'quote') return { label: '引用', color: 'var(--amber)' };
  return { label: '顶层帖', color: 'var(--blue)' };
}

function Field({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[74px_1fr] gap-2 px-3 py-1.5 border-b border-[#15171b]">
      <span className="text-(--dim)">{k}</span>
      <span className="min-w-0 wrap-break-word">{children}</span>
    </div>
  );
}
