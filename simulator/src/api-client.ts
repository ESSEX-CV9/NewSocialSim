import type { SimulatorHeartbeat } from '@socialsim/shared';

/**
 * HTTP API client for the simulator to interact with the social site.
 * All operations go through the same API that real users use.
 */

export interface ApiClientConfig {
  baseUrl: string;
}

export interface LoginResult {
  token: string;
  user: { id: string; handle: string; displayName: string };
}

/** 活动世界 npc 档案 = 被驱动账号的完整驱动配置（GET /api/admin/npc-profiles 形态）。 */
export interface NpcProfileDto {
  userId: number;
  handle: string;
  tier: 'core' | 'ambient';
  personality?: string;
  stance?: string;
  writingStyle?: string;
  interests: string[];
  activeHoursStart: number;
  activeHoursEnd: number;
  postProbability: number;
  likeProbability: number;
  repostProbability: number;
  replyProbability: number;
  actionIntervalMinutes: number;
}

/** GET /api/admin/worlds/active 形态：含世界 id 与时钟（流速/暂停态）。 */
export interface ActiveWorld {
  meta: { id: string; clock: { simTimeMs: number; scale: number; paused: boolean } };
  simTimeMs: number;
}

export class ApiClient {
  private baseUrl: string;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
  }

  async login(handle: string, password: string): Promise<LoginResult> {
    const res = await this.post('/api/auth/login', { handle, password });
    return res as LoginResult;
  }

  async createPost(token: string, content: string, replyToId?: string): Promise<{ id: string }> {
    const body: Record<string, string> = { content };
    if (replyToId) body.replyToId = replyToId;
    const res = await this.post('/api/posts', body, token) as { post: { id: string | number } };
    return { id: String(res.post.id) };
  }

  async likePost(token: string, postId: string): Promise<void> {
    await this.post(`/api/posts/${postId}/like`, {}, token);
  }

  async unlikePost(token: string, postId: string): Promise<void> {
    await this.delete(`/api/posts/${postId}/like`, token);
  }

  async repost(token: string, postId: string): Promise<void> {
    await this.post(`/api/posts/${postId}/repost`, {}, token);
  }

  async follow(token: string, userId: string): Promise<void> {
    await this.post(`/api/users/${userId}/follow`, {}, token);
  }

  async unfollow(token: string, userId: string): Promise<void> {
    await this.delete(`/api/users/${userId}/follow`, token);
  }

  async getTimeline(token: string, limit = 20, feed: 'home' | 'global' = 'global'): Promise<{ items: any[]; nextCursor: string | null }> {
    return await this.get(`/api/timeline/${feed}?limit=${limit}`, token);
  }

  async getUserPosts(userId: string, token?: string, limit = 20): Promise<{ items: any[]; nextCursor: string | null }> {
    return await this.get(`/api/users/${userId}/posts?limit=${limit}`, token);
  }

  async getPost(postId: string, token?: string): Promise<any> {
    return await this.get(`/api/posts/${postId}`, token);
  }

  async searchPosts(query: string, token?: string, limit = 20): Promise<{ items: any[]; nextCursor: string | null }> {
    return await this.get(`/api/search/posts?q=${encodeURIComponent(query)}&limit=${limit}`, token);
  }

  async getUser(userId: string, token?: string): Promise<any> {
    return await this.get(`/api/users/${userId}`, token);
  }

  async getUserByHandle(handle: string, token?: string): Promise<any> {
    return await this.get(`/api/users/by-handle/${encodeURIComponent(handle)}`, token);
  }

  // --- Topics & Content Pools (admin) ---

  async getActiveTopics(adminToken: string): Promise<{ topics: any[] }> {
    return await this.get('/api/admin/topics?active=true', adminToken);
  }

  async getContentPools(adminToken: string): Promise<{ scenePools: Record<string, string[]>; topicPools: Record<string, string[]> }> {
    return await this.get('/api/admin/content-pools', adminToken);
  }

  async getFollowers(userId: string, token: string, limit = 50): Promise<{ items: any[] }> {
    return await this.get(`/api/users/${userId}/followers?limit=${limit}`, token);
  }

  // --- Admin APIs (simulator management key) ---

  async adminCreatePost(adminToken: string, body: {
    authorId: string;
    content: string;
    createdAt?: number;
    replyToId?: string;
    quoteOfId?: string;
  }): Promise<{ id: string }> {
    return await this.post('/api/admin/posts', body, adminToken) as { id: string };
  }

  async adminBulkFollow(adminToken: string, pairs: Array<{ followerId: string; followeeId: string }>): Promise<void> {
    await this.post('/api/admin/follows', { pairs }, adminToken);
  }

  async adminCreateUser(adminToken: string, body: { handle: string; displayName: string; password?: string }): Promise<{
    id: number;
    handle: string;
    displayName: string;
    password: string;
  }> {
    return await this.post('/api/admin/users', body, adminToken) as { id: number; handle: string; displayName: string; password: string };
  }

  async getNpcProfiles(adminToken: string): Promise<{ profiles: NpcProfileDto[] }> {
    return await this.get('/api/admin/npc-profiles', adminToken) as { profiles: NpcProfileDto[] };
  }

  async adminLoginAs(adminToken: string, userId: number): Promise<{ token: string; userId: number; handle: string; displayName: string }> {
    return await this.post('/api/admin/login-as', { userId }, adminToken) as { token: string; userId: number; handle: string; displayName: string };
  }

  async getActiveWorld(): Promise<ActiveWorld | null> {
    try {
      return await this.get('/api/admin/worlds/active') as ActiveWorld;
    } catch {
      return null;
    }
  }

  /** 上报模拟器心跳（无鉴权；失败不抛，心跳丢一两次无所谓）。 */
  async reportSimulatorStatus(hb: SimulatorHeartbeat): Promise<void> {
    try {
      await this.post('/api/simulator/heartbeat', hb);
    } catch {
      // ignore — 心跳是尽力而为
    }
  }

  async adminUpdateCounts(adminToken: string, postId: string, deltas: {
    likeCount?: number;
    repostCount?: number;
    replyCount?: number;
    viewCount?: number;
  }): Promise<void> {
    await this.post(`/api/admin/posts/${postId}/counts`, deltas, adminToken);
  }

  // --- Low-level HTTP ---

  async get(path: string, token?: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, await res.text(), path);
    return res.json();
  }

  private async post(path: string, body: unknown, token?: string): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new ApiError(res.status, await res.text(), path);
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  }

  private async delete(path: string, token?: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, await res.text(), path);
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    public path: string,
  ) {
    super(`API ${path} returned ${status}: ${body.slice(0, 200)}`);
  }
}
