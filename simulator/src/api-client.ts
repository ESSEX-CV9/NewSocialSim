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
    return await this.post('/api/posts', body, token) as { id: string };
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
