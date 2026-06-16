import type { PostView, UserSummary, InteractionEvent } from '@socialsim/shared';

/**
 * 时间轴块模型：块 = 世界真实内容（按 m5-design.md，时间轴是查看/编辑全部帖子与互动的面板）。
 * - 帖子/回复/引用：社交站全站流 /api/timeline/global（顶层帖）+ 按账号 ?type=replies（回复）。
 * - 互动（赞/转/关注）：按账号 /api/users/:handle/interactions（带发生时间 at）。
 * 全部来自 world.db、与模拟器无关；决策轨迹"为什么"待 postId 合并后作为帖子块增强。
 */

export interface PostBlock {
  kind: 'post';
  key: string;
  entity: string; // 作者 handle（轨道）
  time: number; // post.createdAt
  action: 'post' | 'reply' | 'quote';
  post: PostView;
}
export interface LikeBlock {
  kind: 'like';
  key: string;
  entity: string; // 点赞者 handle
  time: number; // 点赞时间
  actorName: string;
  post: PostView; // 被赞帖
}
export interface RepostBlock {
  kind: 'repost';
  key: string;
  entity: string; // 转发者 handle
  time: number; // 转发时间
  actorName: string;
  post: PostView; // 原帖
}
export interface FollowBlock {
  kind: 'follow';
  key: string;
  entity: string; // 关注者 handle
  time: number; // 关注时间
  actorName: string;
  target: UserSummary; // 被关注者
}
export type TimelineBlock = PostBlock | LikeBlock | RepostBlock | FollowBlock;

export function postAction(p: PostView): 'post' | 'reply' | 'quote' {
  if (p.quoteOfId != null) return 'quote';
  if (p.replyToId != null) return 'reply';
  return 'post';
}

export function postToBlock(p: PostView): PostBlock {
  return { kind: 'post', key: `post:${p.id}`, entity: p.author.handle, time: p.createdAt, action: postAction(p), post: p };
}

/** 互动事件去重 key（actor + 对象）。 */
export function interactionKey(actor: string, ev: InteractionEvent): string {
  return ev.type === 'follow' ? `follow:${actor}:${ev.target.id}` : `${ev.type}:${actor}:${ev.post.id}`;
}

/** 互动事件 → 块；actorName 为互动者昵称（渲染时由 nameOf 解析传入）。 */
export function interactionToBlock(actor: string, actorName: string, ev: InteractionEvent): TimelineBlock {
  if (ev.type === 'follow') {
    return { kind: 'follow', key: interactionKey(actor, ev), entity: actor, time: ev.at, actorName, target: ev.target };
  }
  return { kind: ev.type, key: interactionKey(actor, ev), entity: actor, time: ev.at, actorName, post: ev.post };
}

/** 块上显示的文字。 */
export function blockLabel(b: TimelineBlock): string {
  switch (b.kind) {
    case 'post': return b.post.content?.trim() || '（无正文）';
    case 'like': return `赞 ${b.post.author.displayName}`;
    case 'repost': return `转 ${b.post.author.displayName}`;
    case 'follow': return `关注 ${b.target.displayName}`;
  }
}
