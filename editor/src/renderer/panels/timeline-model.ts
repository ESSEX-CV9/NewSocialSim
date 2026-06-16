import type { PostView, TimelineItem, UserSummary } from '@socialsim/shared';

/**
 * 时间轴块模型：块 = 世界真实内容（按 m5-design.md，时间轴是查看/编辑全部帖子与互动的面板）。
 * 数据源为社交站全站时间流 GET /api/timeline/global——纯读 world.db、与模拟器无关。
 * - 帖子/回复/引用：TimelineItem.type='post'。
 * - 转发：TimelineItem.type='repost'（一种互动，由 repostedBy 在 activityAt 转发某帖）。
 * 赞/关注等其余互动需服务端互动事件流端点，后续轮次接入；决策轨迹"为什么"亦后续以 postId 合并。
 */

export interface PostBlock {
  kind: 'post';
  key: string;
  entity: string; // 作者 handle（轨道）
  time: number; // activityAt（= 发布的模拟时间）
  action: 'post' | 'reply' | 'quote';
  post: PostView;
}
export interface RepostBlock {
  kind: 'repost';
  key: string;
  entity: string; // 转发者 handle（轨道）
  time: number; // activityAt（转发的模拟时间）
  post: PostView; // 被转发的原帖
  by: UserSummary; // 转发者
}
export type TimelineBlock = PostBlock | RepostBlock;

export function postAction(p: PostView): 'post' | 'reply' | 'quote' {
  if (p.quoteOfId != null) return 'quote';
  if (p.replyToId != null) return 'reply';
  return 'post';
}

/** 全站流条目的稳定 key（用于去重与块标识）。 */
export function itemKey(it: TimelineItem): string {
  return it.type === 'repost' && it.repostedBy ? `repost:${it.post.id}:${it.repostedBy.id}` : `post:${it.post.id}`;
}

/** TimelineItem → 时间轴块。 */
export function itemToBlock(it: TimelineItem): TimelineBlock {
  if (it.type === 'repost' && it.repostedBy) {
    return { kind: 'repost', key: itemKey(it), entity: it.repostedBy.handle, time: it.activityAt, post: it.post, by: it.repostedBy };
  }
  return { kind: 'post', key: itemKey(it), entity: it.post.author.handle, time: it.activityAt, action: postAction(it.post), post: it.post };
}

/** 块上显示的文字：帖子用正文片段，转发用"转 {原作者}"。 */
export function blockLabel(b: TimelineBlock): string {
  if (b.kind === 'repost') return `转 ${b.post.author.displayName}`;
  return b.post.content?.trim() || '（无正文）';
}
