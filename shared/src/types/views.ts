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
  /** 观察者是否已关注作者（本人帖与匿名时为 false；供帖子菜单的关注快捷项） */
  authorFollowedByViewer: boolean;
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
  /** actor 的粉丝数与"是否被通知所有者关注"——前端聚合时用于挑选最重要的头像 */
  actorFollowerCount: number;
  actorFollowedByViewer: boolean;
  postId: number | null;
  /** 相关帖子的内容预览（前 100 字符）；无帖子或帖子已删除时为 null */
  postExcerpt: string | null;
  read: boolean;
  createdAt: number;
}

/** 趋势条目：近期被讨论的 #话题（右边栏"有什么新鲜事"） */
export interface TrendItem {
  /** 含 # 前缀，保留首次出现的原始大小写 */
  tag: string;
  /** 近期提及该话题的帖子数（同帖同话题只计一次） */
  postCount: number;
}

/** 游标分页的统一包装 */
export interface Page<T> {
  items: T[];
  /** 传回下一页请求的 cursor；null 表示没有更多 */
  nextCursor: string | null;
}
