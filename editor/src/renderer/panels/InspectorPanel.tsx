import { useEffect, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import type { PostView, StoredSimTraceEvent } from '@socialsim/shared';
import { useSelectedBlock, setSelectedBlock } from '../state/selection.js';
import type { TimelineBlock, PostBlock, LikeBlock, RepostBlock, FollowBlock } from './timeline-model.js';
import { formatSimTime, ACTION_LABEL } from './trace-meta.js';
import { Avatar } from './Avatar.js';

/**
 * 检视器：展示当前选中块的详情（样式对齐 docs/editor-mockup.html）。
 * 帖子块→帖子预览；赞/转块→互动者 + 被作用帖预览；关注块→关注者 + 被关注者。
 * 帖子/赞/转块下附**决策轨迹"为什么"**（T.4）：若该动作是模拟器做的，按 postId / (actor+目标帖+动作)
 * 关联 sim-trace.db 的轨迹，展示意图/形态/池/配图原因等决策依据；真人或种子内容无轨迹。
 */

/** 时间窗兜底半宽：老数据无 postId 时按 simTime≈createdAt 取最接近的轨迹。 */
const TRACE_FALLBACK_WINDOW_MS = 5 * 60_000;

/**
 * 按选中块关联其决策轨迹（模拟器产出才有）：
 * - 帖子块：先按产出帖 postId 精确匹配（本特性上线后模拟器产出的帖）；匹配不到则兜底按
 *   账号+动作+时间窗取最接近的一条（兼容上线前无 postId 的老轨迹）。
 * - 赞/转块：按 账号+目标帖+动作 精确匹配（无需 postId，老数据亦可）。
 * - 关注块：trace 未记被关注者，无从关联，不查。
 * 真人 / 种子内容本就没有轨迹，返回 null。
 */
function useBlockTrace(block: TimelineBlock | null): { trace: StoredSimTraceEvent | null; loading: boolean } {
  const [trace, setTrace] = useState<StoredSimTraceEvent | null>(null);
  const [loading, setLoading] = useState(false);

  // 稳定 key：选中块不变则不重复查（关注块 / 无块为空 key）。
  let key = '';
  if (block && block.kind === 'post') key = `post:${block.post.id}:${block.action}:${block.entity}:${block.time}`;
  else if (block && (block.kind === 'like' || block.kind === 'repost')) key = `${block.kind}:${block.entity}:${block.post.id}`;

  useEffect(() => {
    if (!key || !block) {
      setTrace(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setTrace(null);
    const backend = window.editor.backendUrl;
    const enc = encodeURIComponent;
    async function fetchEvents(qs: string): Promise<StoredSimTraceEvent[]> {
      const r = await fetch(`${backend}/api/trace?${qs}`);
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { events?: StoredSimTraceEvent[] };
      return j.events ?? [];
    }
    void (async () => {
      try {
        let ev: StoredSimTraceEvent | null = null;
        if (block.kind === 'post') {
          const pid = String(block.post.id);
          ev = (await fetchEvents(`postId=${enc(pid)}&limit=1`))[0] ?? null;
          if (!ev) {
            // 兜底：无 postId 的老轨迹按 账号+动作+时间窗 取 simTime 最接近本帖 createdAt 的一条。
            const list = await fetchEvents(
              `entity=${enc(block.entity)}&action=${block.action}` +
                `&from=${Math.round(block.time - TRACE_FALLBACK_WINDOW_MS)}` +
                `&to=${Math.round(block.time + TRACE_FALLBACK_WINDOW_MS)}`,
            );
            ev = list.reduce<StoredSimTraceEvent | null>((best, e) => {
              if (e.postId && e.postId !== pid) return best; // 已带 postId 但非本帖：是邻近帖，跳过
              if (!best) return e;
              return Math.abs(e.simTime - block.time) < Math.abs(best.simTime - block.time) ? e : best;
            }, null);
          }
        } else if (block.kind === 'like' || block.kind === 'repost') {
          ev =
            (await fetchEvents(
              `entity=${enc(block.entity)}&targetPostId=${enc(String(block.post.id))}&action=${block.kind}&limit=1`,
            ))[0] ?? null;
        }
        if (alive) setTrace(ev);
      } catch {
        if (alive) setTrace(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { trace, loading };
}
export function InspectorPanel(_props: IDockviewPanelProps) {
  const block = useSelectedBlock();
  const { trace, loading } = useBlockTrace(block);

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
      {block.kind !== 'follow' && <TraceWhy trace={trace} loading={loading} />}
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

/**
 * 决策轨迹「为什么」增强层（T.4）：展示该动作的决策依据。
 * 模拟器产出的帖/赞/转才有轨迹；真人或种子内容、或模拟器在本特性前发的内容显示"无轨迹"。
 */
function TraceWhy({ trace, loading }: { trace: StoredSimTraceEvent | null; loading: boolean }) {
  return (
    <div className="mt-1">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-(--border) bg-(--panel2)">
        <i className="ri-flow-chart text-(--blue)" />
        <b className="text-[12px]">决策轨迹 · 为什么</b>
      </div>
      {loading ? (
        <p className="px-3 py-2 text-(--dim)">查询中…</p>
      ) : !trace ? (
        <p className="px-3 py-2 text-(--dim)">无决策轨迹（真人 / 种子内容，或非模拟器产出）。</p>
      ) : (
        <>
          <Field k="动作">{ACTION_LABEL[trace.action]}</Field>
          {trace.intent && <Field k="意图">{trace.intent}</Field>}
          {trace.activityState && <Field k="活动状态">{trace.activityState}</Field>}
          {trace.shape && <Field k="形态">{trace.shape}</Field>}
          {trace.poolId && <Field k="命中池"><span className="font-mono">{trace.poolId}</span></Field>}
          {trace.entryId && <Field k="语法/条目"><span className="font-mono">{trace.entryId}</span></Field>}
          <Field k="配图">{trace.mediaAttached ? trace.mediaReason || '是' : '否'}</Field>
          <Field k="世界时间"><span className="font-mono">{formatSimTime(trace.simTime)}</span></Field>
          <Field k="现实时间"><span className="font-mono">{formatSimTime(trace.at)}</span></Field>
        </>
      )}
    </div>
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
