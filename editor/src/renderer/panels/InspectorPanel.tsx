import type { IDockviewPanelProps } from 'dockview';
import type { PostView } from '@socialsim/shared';
import { useSelectedBlock, setSelectedBlock } from '../state/selection.js';
import type { TimelineBlock, PostBlock, LikeBlock, RepostBlock, FollowBlock } from './timeline-model.js';
import { formatSimTime } from './trace-meta.js';
import { Avatar } from './Avatar.js';

/**
 * 检视器：展示当前选中块的详情（样式对齐 docs/editor-mockup.html）。
 * 帖子块→帖子预览；赞/转块→互动者 + 被作用帖预览；关注块→关注者 + 被关注者。
 * 决策轨迹"为什么"待 postId 合并后作为帖子块增强接入。
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
  const title = block.kind === 'follow' ? '关注' : `帖子 #${block.post.id}`;
  return (
    <div className="text-xs text-(--text) overflow-y-auto h-full">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-(--border)">
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md text-white" style={{ background: pill.color }}>
          {pill.label}
        </span>
        <b className="text-[13px]">{title}</b>
        <button
          onClick={() => setSelectedBlock(null)}
          className="ml-auto text-(--dim) hover:text-(--text) cursor-pointer"
          title="清除选中"
        >
          <i className="ri-close-line" />
        </button>
      </div>
      {block.kind === 'post' && <PostDetail block={block} />}
      {block.kind === 'like' && <ActorPostDetail block={block} verb="赞了" />}
      {block.kind === 'repost' && <ActorPostDetail block={block} verb="转发了" />}
      {block.kind === 'follow' && <FollowDetail block={block} />}
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

function ActorPostDetail({ block, verb }: { block: LikeBlock | RepostBlock; verb: string }) {
  return (
    <>
      <div className="flex items-center gap-1.5 px-3 pt-3 text-(--dim)">
        <i className={block.kind === 'like' ? 'ri-heart-line' : 'ri-repeat-line'} />
        <Avatar handle={block.entity} name={block.actorName} size={16} />
        <span className="text-(--text)">{block.actorName}</span> {verb}
      </div>
      <PostCard post={block.post} />
      <Field k={block.kind === 'like' ? '点赞者' : '转发者'}>{block.actorName} · @{block.entity}</Field>
      <Field k={block.kind === 'like' ? '点赞时间' : '转发时间'}><span className="font-mono">{formatSimTime(block.time)}</span></Field>
      <Field k="原帖作者">{block.post.author.displayName} · @{block.post.author.handle}</Field>
      <Field k="原帖 id"><span className="font-mono">#{block.post.id}</span></Field>
    </>
  );
}

function FollowDetail({ block }: { block: FollowBlock }) {
  return (
    <>
      <div className="flex items-center gap-1.5 px-3 py-3 border-b border-[#15171b]">
        <Avatar handle={block.entity} name={block.actorName} size={20} />
        <span className="font-semibold">{block.actorName}</span>
        <i className="ri-arrow-right-line text-(--dim)" /> 关注了
        <Avatar handle={block.target.handle} name={block.target.displayName} size={20} />
        <span className="font-semibold">{block.target.displayName}</span>
      </div>
      <Field k="关注者">{block.actorName} · @{block.entity}</Field>
      <Field k="被关注者">{block.target.displayName} · @{block.target.handle}</Field>
      <Field k="关注时间"><span className="font-mono">{formatSimTime(block.time)}</span></Field>
    </>
  );
}

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
  switch (b.kind) {
    case 'like': return { label: '点赞', color: '#3a3f46' };
    case 'repost': return { label: '转发', color: '#3a3f46' };
    case 'follow': return { label: '关注', color: '#3a3f46' };
    default:
      return b.action === 'reply'
        ? { label: '回复', color: 'var(--green)' }
        : b.action === 'quote'
          ? { label: '引用', color: 'var(--amber)' }
          : { label: '顶层帖', color: 'var(--blue)' };
  }
}

function Field({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[74px_1fr] gap-2 px-3 py-1.5 border-b border-[#15171b]">
      <span className="text-(--dim)">{k}</span>
      <span className="min-w-0 wrap-break-word">{children}</span>
    </div>
  );
}
