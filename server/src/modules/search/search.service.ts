import type { Page, PostView, TrendItem, UserSummary, VerifiedType } from '@socialsim/shared';
import { ValidationError } from '../../core/errors/app-error.js';
import { decodeCursor, encodeCursor } from '../../core/pagination.js';
import type { WorldManager } from '../../core/world/world-manager.js';
import { mediaFileUrl } from '../media/media.service.js';
import { clampLimit, type PostsService } from '../posts/posts.service.js';
import { searchRepo } from './search.repo.js';

/** 与前端 PostContent 的 #话题 解析口径一致 */
const HASHTAG_RE = /#[^\s#@]+/g;
/** 趋势统计窗口：近 7 个模拟日 */
const TREND_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TREND_LIMIT = 10;
const MAX_TREND_LIMIT = 20;

export class SearchService {
  constructor(
    private readonly worldManager: WorldManager,
    private readonly postsService: PostsService,
  ) {}

  /** 近期 #话题 排行：按提及帖子数降序（同帖同话题只计一次） */
  trends(limit?: number): TrendItem[] {
    const { db, clock } = this.worldManager.current();
    const since = clock.now() - TREND_WINDOW_MS;
    const counts = new Map<string, TrendItem>();
    for (const { content } of searchRepo.recentHashtagContents(db, since)) {
      const tags = new Set([...content.matchAll(HASHTAG_RE)].map((m) => m[0]));
      for (const tag of tags) {
        const key = tag.toLowerCase();
        const entry = counts.get(key);
        if (entry) entry.postCount += 1;
        else counts.set(key, { tag, postCount: 1 });
      }
    }
    const top = limit === undefined ? DEFAULT_TREND_LIMIT : Math.max(1, Math.min(MAX_TREND_LIMIT, Math.floor(limit)));
    return [...counts.values()]
      .sort((a, b) => b.postCount - a.postCount || a.tag.localeCompare(b.tag))
      .slice(0, top);
  }

  posts(query: string, viewerId: number | null, cursor?: string, limit?: number): Page<PostView> {
    const q = normalizeQuery(query);
    const { db } = this.worldManager.current();
    const pageSize = clampLimit(limit);
    const rows = searchRepo.searchPosts(db, q, viewerId, parseIdCursor(cursor), pageSize + 1);
    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
    const last = pageRows[pageRows.length - 1];
    return {
      items: this.postsService.buildViews(pageRows, viewerId),
      nextCursor: hasMore && last ? encodeCursor([last.id]) : null,
    };
  }

  users(query: string, cursor?: string, limit?: number): Page<UserSummary> {
    const q = normalizeQuery(query);
    const { db, worldId } = this.worldManager.current();
    const pageSize = clampLimit(limit);
    const rows = searchRepo.searchUsers(db, q, parseIdCursor(cursor), pageSize + 1);
    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
    const last = pageRows[pageRows.length - 1];
    const items: UserSummary[] = pageRows.map((r) => ({
      id: r.id,
      handle: r.handle,
      displayName: r.display_name,
      isBot: r.is_bot === 1,
      avatarUrl: mediaFileUrl(r.avatar_media_id, worldId),
      verified: r.verified as VerifiedType,
    }));
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor([last.id]) : null,
    };
  }
}

function normalizeQuery(query: string): string {
  const q = query.trim();
  if (q.length === 0) throw new ValidationError('搜索关键词不能为空');
  return q;
}

function parseIdCursor(cursor: string | undefined): number | null {
  const parts = decodeCursor(cursor);
  return parts && parts.length === 1 && typeof parts[0] === 'number' ? parts[0] : null;
}
