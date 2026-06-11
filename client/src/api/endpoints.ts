import type {
  ActiveWorldInfo,
  AuthResponse,
  CreatePostRequest,
  LoginRequest,
  NotificationView,
  Page,
  PostView,
  RegisterRequest,
  TimelineItem,
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
  getUserPosts: (handle: string, cursor?: string) =>
    http<Page<PostView>>('GET', withPage(`/api/users/${handle}/posts`, cursor)),
  deletePost: (id: number) => http<void>('DELETE', `/api/posts/${id}`),

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

  // timeline
  homeTimeline: (cursor?: string) =>
    http<Page<TimelineItem>>('GET', withPage('/api/timeline/home', cursor)),
  globalTimeline: (cursor?: string) =>
    http<Page<TimelineItem>>('GET', withPage('/api/timeline/global', cursor)),

  // notifications
  notifications: (cursor?: string) =>
    http<Page<NotificationView>>('GET', withPage('/api/notifications', cursor)),
  unreadCount: () => http<{ count: number }>('GET', '/api/notifications/unread-count'),
  markAllRead: () => http<void>('POST', '/api/notifications/read-all'),

  // search
  searchPosts: (q: string, cursor?: string) =>
    http<Page<PostView>>('GET', withPage('/api/search/posts', cursor, { q })),
  searchUsers: (q: string, cursor?: string) =>
    http<Page<UserSummary>>('GET', withPage('/api/search/users', cursor, { q })),

  // worlds
  listWorlds: () => http<{ worlds: WorldSummary[] }>('GET', '/api/admin/worlds'),
  createWorld: (input: {
    id: string;
    name: string;
    description?: string;
    locale?: 'zh-CN' | 'en';
    clock?: { simTimeMs?: number; scale?: number; paused?: boolean };
    calendar?: { label: string };
  }) => http<{ world: WorldMeta }>('POST', '/api/admin/worlds', input),
  activateWorld: (id: string) =>
    http<ActiveWorldInfo>('POST', `/api/admin/worlds/${id}/activate`, {}),
  activeWorld: () => http<ActiveWorldInfo>('GET', '/api/admin/worlds/active'),
};
