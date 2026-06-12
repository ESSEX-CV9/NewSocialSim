import type { Post } from './post.js';
import type { VerifiedType } from './user.js';

/** 嵌入在帖子/通知里的轻量用户信息 */
export interface UserSummary {
  id: number;
  handle: string;
  displayName: string;
  isBot: boolean;
  /** 头像图片地址；null = 用 handle 哈希色块兜底 */
  avatarUrl: string | null;
  /** 认证标识（蓝标/金标），随用户名各显示点展示 */
  verified: VerifiedType;
}

/** 媒体资源视图（文件本体经 url 流式获取） */
export interface MediaView {
  id: number;
  type: 'image' | 'video';
  /** /api/media/<id>/file?w=<worldId>，公开可访问（流式引用视频为 /stream 端点） */
  url: string;
  width: number | null;
  height: number | null;
  /** 视频时长（毫秒）；图片或未知为不出现/null */
  durationMs?: number | null;
  /** 视频海报图地址（外站引入时随片下载）；无海报为 null */
  posterUrl?: string | null;
  /** 视频存储形态：'library' 文件入库 / 'stream' 流式引用（源失效则不可播） */
  storage?: 'library' | 'stream';
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
  /** 附加媒体（最多 20 个，图/视频可混排），按 position 排序；墓碑帖为空数组 */
  media: MediaView[];
  /** 正文首个 URL 的链接卡片；有媒体时不显示（X 行为），抓取失败为 null */
  linkCard: LinkCardView | null;
  /** 被回复帖的一层嵌入（仅个人主页"回复"Tab 填充）；观察者不可见（已删/被屏蔽/被隐藏）时为 null */
  inReplyTo?: PostView | null;
  /** 被回复帖作者 handle（仅"回复"Tab 填充）；嵌入不可见时前端降级显示"回复 @handle" */
  replyToHandle?: string | null;
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
  /** 相关帖子的首个媒体（通知卡缩略图）；无媒体或帖子已删除时为 null */
  postMedia: { type: 'image' | 'video'; url: string } | null;
  read: boolean;
  createdAt: number;
}

/** 正文首个 URL 的 OG 链接预览卡片（抓取失败/有媒体时为 null） */
export interface LinkCardView {
  url: string;
  title: string;
  description: string | null;
  /** 缩略图已下载入库的本地地址 */
  imageUrl: string | null;
  siteName: string | null;
  /** 可嵌入播放器地址（YouTube/B 站等已知站点由 url 现算）；不支持的站点为 null */
  embedUrl: string | null;
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
