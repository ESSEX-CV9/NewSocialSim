import type { StoredSimTraceEvent, PostView, SimTraceAction } from '@socialsim/shared';
import { ACTION_LABEL } from './trace-meta.js';

/**
 * 时间轴块模型：块 = 世界真实内容（按 m5-design.md，时间轴是查看/编辑全部帖子与互动的面板）。
 * - 帖子/回复/引用来自社交站 API（真相源，含种子/真人/0.3 前的）。
 * - 互动（赞/转/关注）暂来自模拟器决策轨迹（API 无互动时间流，真人互动待服务端端点）。
 * 决策轨迹退为"为什么"的增强层：帖子块点开后再附其轨迹（postId 匹配，后续轮次）。
 */

export interface PostBlock {
  kind: 'post';
  key: string;
  entity: string; // 作者 handle（轨道）
  time: number; // post.createdAt（模拟时间）
  action: 'post' | 'reply' | 'quote';
  post: PostView;
}
export interface TraceBlock {
  kind: 'trace';
  key: string;
  entity: string;
  time: number; // event.simTime
  action: SimTraceAction; // like | repost | follow
  event: StoredSimTraceEvent;
}
export type TimelineBlock = PostBlock | TraceBlock;

/** 帖子按 quoteOfId / replyToId 推断形态。 */
export function postAction(p: PostView): 'post' | 'reply' | 'quote' {
  if (p.quoteOfId != null) return 'quote';
  if (p.replyToId != null) return 'reply';
  return 'post';
}

/** 块上显示的文字：帖子用正文片段，互动用动作名。 */
export function blockLabel(b: TimelineBlock): string {
  if (b.kind === 'post') return b.post.content?.trim() || '（无正文）';
  return ACTION_LABEL[b.action];
}
