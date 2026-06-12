import type {
  ActiveWorldInfo,
  AuthResponse,
  ConversationDetailView,
  ConversationView,
  CreatePostRequest,
  DmConversationFilter,
  DmSearchResults,
  DmUnreadCount,
  LoginRequest,
  MediaView,
  MessageReactionView,
  MessageView,
  NotificationView,
  Page,
  PostView,
  RegisterRequest,
  TimelineItem,
  TrendItem,
  UpdateProfileRequest,
  UserProfile,
  UserSummary,
  WorldMeta,
  WorldSummary,
} from '@socialsim/shared';
import { http } from './http';

function withPage(url: string, cursor?: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams(extra);
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export const api = {
  // auth
  register: (input: RegisterRequest) => http<AuthResponse>('POST', '/api/auth/register', input),
  login: (input: LoginRequest) => http<AuthResponse>('POST', '/api/auth/login', input),
  me: () => http<{ user: UserProfile }>('GET', '/api/auth/me'),

  // users
  getUser: (handle: string) => http<{ user: UserProfile }>('GET', `/api/users/${handle}`),
  updateMe: (patch: UpdateProfileRequest) =>
    http<{ user: UserProfile }>('PATCH', '/api/users/me', patch),

  // posts
  createPost: (input: CreatePostRequest) => http<{ post: PostView }>('POST', '/api/posts', input),
  getPost: (id: number) => http<{ post: PostView }>('GET', `/api/posts/${id}`),
  getReplies: (id: number, cursor?: string) =>
    http<Page<PostView>>('GET', withPage(`/api/posts/${id}/replies`, cursor)),
  getUserPosts: (handle: string, cursor?: string, type: 'posts' | 'replies' = 'posts') =>
    http<Page<PostView>>('GET', withPage(`/api/users/${handle}/posts`, cursor, { type })),
  getUserLikes: (handle: string, cursor?: string) =>
    http<Page<PostView>>('GET', withPage(`/api/users/${handle}/likes`, cursor)),
  deletePost: (id: number) => http<void>('DELETE', `/api/posts/${id}`),
  recordViews: (ids: number[]) => http<void>('POST', '/api/posts/views', { ids }),
  // media
  uploadMedia: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return http<{ media: MediaView }>('POST', '/api/media/upload', form);
  },
  getUserMedia: (handle: string, cursor?: string) =>
    http<Page<PostView>>('GET', withPage(`/api/users/${handle}/media`, cursor)),
  mediaFromUrl: (url: string, source?: string) =>
    http<{ media: MediaView }>('POST', '/api/media/from-url', { url, ...(source ? { source } : {}) }),

  pinPost: (id: number) => http<{ pinnedPostId: number | null }>('POST', `/api/posts/${id}/pin`),
  unpinPost: (id: number) =>
    http<{ pinnedPostId: number | null }>('DELETE', `/api/posts/${id}/pin`),
  hidePost: (id: number) => http<{ active: boolean }>('POST', `/api/posts/${id}/hide`),
  unhidePost: (id: number) => http<{ active: boolean }>('DELETE', `/api/posts/${id}/hide`),

  // interactions
  like: (id: number) => http<{ active: boolean; count: number }>('POST', `/api/posts/${id}/like`),
  unlike: (id: number) =>
    http<{ active: boolean; count: number }>('DELETE', `/api/posts/${id}/like`),
  repost: (id: number) =>
    http<{ active: boolean; count: number }>('POST', `/api/posts/${id}/repost`),
  unrepost: (id: number) =>
    http<{ active: boolean; count: number }>('DELETE', `/api/posts/${id}/repost`),

  // follows
  follow: (handle: string) => http<{ following: boolean }>('POST', `/api/users/${handle}/follow`),
  unfollow: (handle: string) =>
    http<{ following: boolean }>('DELETE', `/api/users/${handle}/follow`),
  followers: (handle: string, cursor?: string) =>
    http<Page<UserSummary>>('GET', withPage(`/api/users/${handle}/followers`, cursor)),
  following: (handle: string, cursor?: string) =>
    http<Page<UserSummary>>('GET', withPage(`/api/users/${handle}/following`, cursor)),

  // blocks
  blockUser: (handle: string) => http<{ blocked: boolean }>('POST', `/api/users/${handle}/block`),
  unblockUser: (handle: string) =>
    http<{ blocked: boolean }>('DELETE', `/api/users/${handle}/block`),

  // timeline
  homeTimeline: (cursor?: string, sort: 'latest' | 'hot' = 'latest') =>
    http<Page<TimelineItem>>('GET', withPage('/api/timeline/home', cursor, { sort })),
  foryouTimeline: (cursor?: string) =>
    http<Page<TimelineItem>>('GET', withPage('/api/timeline/foryou', cursor)),
  globalTimeline: (cursor?: string) =>
    http<Page<TimelineItem>>('GET', withPage('/api/timeline/global', cursor)),
  getUserTimeline: (handle: string, cursor?: string) =>
    http<Page<TimelineItem>>('GET', withPage(`/api/users/${handle}/timeline`, cursor)),

  // bookmarks
  bookmark: (id: number) => http<{ active: boolean }>('POST', `/api/posts/${id}/bookmark`),
  unbookmark: (id: number) => http<{ active: boolean }>('DELETE', `/api/posts/${id}/bookmark`),
  bookmarks: (cursor?: string) => http<Page<PostView>>('GET', withPage('/api/bookmarks', cursor)),

  // suggestions
  suggestedUsers: () =>
    http<{ users: (UserSummary & { followerCount: number })[] }>('GET', '/api/users/suggested'),

  // notifications
  notifications: (cursor?: string, filter: 'all' | 'mentions' = 'all') =>
    http<Page<NotificationView>>('GET', withPage('/api/notifications', cursor, { filter })),
  unreadCount: () => http<{ count: number }>('GET', '/api/notifications/unread-count'),
  markAllRead: () => http<void>('POST', '/api/notifications/read-all'),
  markRead: (ids: number[]) => http<void>('POST', '/api/notifications/read', { ids }),

  // direct messages
  dmConversations: (filter: DmConversationFilter, cursor?: string) =>
    http<Page<ConversationView>>('GET', withPage('/api/messages/conversations', cursor, { filter })),
  dmSearch: (q: string) =>
    http<DmSearchResults>('GET', `/api/messages/search?q=${encodeURIComponent(q)}`),
  dmMarkAllRead: () => http<void>('POST', '/api/messages/read-all', {}),
  dmFindOrCreate: (userId: number) =>
    http<{ conversation: ConversationDetailView }>('POST', '/api/messages/conversations', { userId }),
  dmGetConversation: (id: number) =>
    http<{ conversation: ConversationDetailView }>('GET', `/api/messages/conversations/${id}`),
  dmMessages: (id: number, cursor?: string) =>
    http<Page<MessageView>>('GET', withPage(`/api/messages/conversations/${id}/messages`, cursor)),
  dmSend: (id: number, content: string, mediaIds?: number[]) =>
    http<{ message: MessageView }>('POST', `/api/messages/conversations/${id}/messages`, {
      content,
      ...(mediaIds && mediaIds.length > 0 ? { mediaIds } : {}),
    }),
  dmMarkRead: (id: number, messageId?: number) =>
    http<{ lastReadMessageId: number }>('POST', `/api/messages/conversations/${id}/read`, {
      ...(messageId !== undefined ? { messageId } : {}),
    }),
  dmAccept: (id: number) =>
    http<{ conversation: ConversationDetailView }>('POST', `/api/messages/conversations/${id}/accept`, {}),
  dmHideConversation: (id: number) => http<void>('DELETE', `/api/messages/conversations/${id}`),
  dmMarkUnread: (id: number) => http<void>('POST', `/api/messages/conversations/${id}/unread`, {}),
  dmMute: (id: number) => http<void>('POST', `/api/messages/conversations/${id}/mute`, {}),
  dmUnmute: (id: number) => http<void>('DELETE', `/api/messages/conversations/${id}/mute`),
  dmPin: (id: number) => http<void>('POST', `/api/messages/conversations/${id}/pin`, {}),
  dmUnpin: (id: number) => http<void>('DELETE', `/api/messages/conversations/${id}/pin`),
  dmDeleteMessage: (messageId: number) =>
    http<{ message: MessageView }>('DELETE', `/api/messages/${messageId}`),
  dmSetReaction: (messageId: number, emoji: string) =>
    http<{ reactions: MessageReactionView[] }>('PUT', `/api/messages/${messageId}/reaction`, { emoji }),
  dmRemoveReaction: (messageId: number) =>
    http<{ reactions: MessageReactionView[] }>('DELETE', `/api/messages/${messageId}/reaction`),
  dmUnreadCount: () => http<DmUnreadCount>('GET', '/api/messages/unread-count'),

  // search
  searchPosts: (q: string, cursor?: string) =>
    http<Page<PostView>>('GET', withPage('/api/search/posts', cursor, { q })),
  searchUsers: (q: string, cursor?: string, limit?: number) =>
    http<Page<UserSummary>>(
      'GET',
      withPage('/api/search/users', cursor, limit !== undefined ? { q, limit: String(limit) } : { q }),
    ),
  trends: () => http<{ trends: TrendItem[] }>('GET', '/api/search/trends'),

  // worlds
  listWorlds: () => http<{ worlds: WorldSummary[] }>('GET', '/api/admin/worlds'),
  createWorld: (input: {
    id: string;
    name: string;
    description?: string;
    locale?: 'zh-CN' | 'en';
    clock?: { simTimeMs?: number; scale?: number; paused?: boolean };
    calendar?: { label: string };
    contentRating?: 'safe' | 'all';
  }) => http<{ world: WorldMeta }>('POST', '/api/admin/worlds', input),
  activateWorld: (id: string) =>
    http<ActiveWorldInfo>('POST', `/api/admin/worlds/${id}/activate`, {}),
  activeWorld: () => http<ActiveWorldInfo>('GET', '/api/admin/worlds/active'),

  // media search
  mediaSearch: (q: string, source?: string, rating?: 'safe' | 'all' | 'r18') =>
    http<{ results: MediaSearchResult[] }>(
      'GET',
      `/api/media-search?q=${encodeURIComponent(q)}${source ? `&source=${encodeURIComponent(source)}` : ''}${rating ? `&rating=${rating}` : ''}`,
    ),
  mediaSearchSources: () =>
    http<{ sources: { id: string; ok: boolean; supportsRating: boolean; reason?: string }[] }>(
      'GET',
      '/api/media-search/sources',
    ),
  mediaSearchConfig: () => http<{ config: MediaSearchMaskedConfig }>('GET', '/api/media-search/config'),
  patchMediaSearchConfig: (patch: Record<string, unknown>) =>
    http<{ config: MediaSearchMaskedConfig }>('PATCH', '/api/media-search/config', patch),
  pixivLogin: () => http<PixivLoginStatus>('POST', '/api/media-search/pixiv/login', {}),
  pixivLoginStatus: () => http<PixivLoginStatus>('GET', '/api/media-search/pixiv/login/status'),
  pixivSubmitCode: (code: string) =>
    http<PixivLoginStatus>('POST', '/api/media-search/pixiv/code', { code }),
  biliLogin: () => http<PixivLoginStatus>('POST', '/api/media-search/bilibili/login', {}),
  biliLoginStatus: () => http<PixivLoginStatus>('GET', '/api/media-search/bilibili/login/status'),

  // video ingest（外站视频引入：auto 按形态路由，可能直接返回 embed 不建任务）
  videoIngest: (url: string, mode: 'auto' | 'download' | 'stream' = 'auto') =>
    http<VideoIngestResult>('POST', '/api/video/ingest', { url, mode }),
  videoTasks: () => http<{ tasks: VideoTaskView[] }>('GET', '/api/video/tasks'),
  videoTaskCancel: (id: string) =>
    http<{ task: VideoTaskView }>('DELETE', `/api/video/tasks/${id}`),

  // video tools (yt-dlp / ffmpeg)
  toolsStatus: () => http<{ tools: ToolStatus[] }>('GET', '/api/tools/status'),
  toolsLatest: () =>
    http<{ latest: { ytdlp: string | null; ffmpeg: string | null } }>('GET', '/api/tools/latest'),
  toolInstall: (id: ToolId) => http<{ job: ToolInstallJob }>('POST', `/api/tools/${id}/install`, {}),
  toolInstallStatus: (id: ToolId) =>
    http<{ job: ToolInstallJob | null }>('GET', `/api/tools/${id}/install/status`),
};

export type VideoTaskStatus = 'pending' | 'probing' | 'downloading' | 'done' | 'error' | 'canceled';

export interface VideoTaskView {
  id: string;
  url: string;
  mode: 'download' | 'stream';
  status: VideoTaskStatus;
  progress: number;
  totalBytes?: number | null;
  title?: string;
  errorCode?: string;
  errorMessage?: string;
  media?: MediaView;
  createdAt: number;
}

export interface VideoIngestResult {
  /** auto 命中嵌入卡：URL 留在正文走链接卡即可，无任务 */
  embed?: { embedUrl: string; site: string };
  task?: VideoTaskView;
}

export type ToolId = 'yt-dlp' | 'ffmpeg';

export interface ToolInstallJob {
  state: 'downloading' | 'extracting' | 'done' | 'error';
  progress: number;
  message?: string;
  file?: string;
  url?: string;
  downloadedBytes?: number;
  totalBytes?: number | null;
  speedBps?: number;
}

export interface ToolStatus {
  id: ToolId;
  installed: boolean;
  version: string | null;
  path: string | null;
  downloadUrl: string;
  defaultUrl: string;
  job: ToolInstallJob | null;
}

/** 搜图候选（与服务端 SearchResult 对应） */
export interface MediaSearchResult {
  url: string;
  preview: string;
  source: string;
  title: string;
  width: number;
  height: number;
  score?: number;
  referer?: string;
}

export interface MediaSearchMaskedConfig {
  proxy: string;
  pixivLoggedIn: boolean;
  pixivAllowR18G: boolean;
  pinterestHasCookies: boolean;
  pexelsHasKey: boolean;
  danbooruHasKey: boolean;
  gelbooruHasKey: boolean;
  toolsYtdlpUrl: string;
  toolsFfmpegUrl: string;
  bilibiliHasCookies: boolean;
}

export interface PixivLoginStatus {
  state: 'idle' | 'launching' | 'waiting' | 'exchanging' | 'success' | 'error';
  message?: string;
  loginUrl?: string;
}
