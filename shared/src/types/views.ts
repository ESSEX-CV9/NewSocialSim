import type { Post } from './post.js';

/** 嵌入在帖子/通知里的轻量用户信息 */
export interface UserSummary {
  id: number;
  handle: string;
  displayName: string;
  isBot: boolean;
}

/** 面向展示的帖子：实体 + 作者 + 观察者状态 + 一层引用嵌入 */
export interface PostView extends Post {
  author: UserSummary;
  likedByViewer: boolean;
  repostedByViewer: boolean;
  /** 观察者是否已收藏（书签私密，不提供计数） */
  bookmarkedByViewer: boolean;
  /** 被引用的帖子（只嵌一层；被删除时为墓碑视图） */
  quoted: PostView | null;
}

export interface TimelineItem {
  type: 'post' | 'repost';
  post: PostView;
  /** type 为 repost 时：是谁转发进时间线的 */
  repostedBy: UserSummary | null;
  /** 排序时间：原帖为发布时间，转发为转发时间（模拟时间） */
  activityAt: number;
}

export type NotificationType = 'reply' | 'quote' | 'like' | 'repost' | 'follow' | 'mention';

export interface NotificationView {
  id: number;
  type: NotificationType;
  actor: UserSummary;
  postId: number | null;
  read: boolean;
  createdAt: number;
}

/** 游标分页的统一包装 */
export interface Page<T> {
  items: T[];
  /** 传回下一页请求的 cursor；null 表示没有更多 */
  nextCursor: string | null;
}
