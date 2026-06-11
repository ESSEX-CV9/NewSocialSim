import type { Page, PostView, UserSummary } from '@socialsim/shared';
import { ValidationError } from '../../core/errors/app-error.js';
import { decodeCursor, encodeCursor } from '../../core/pagination.js';
import type { WorldManager } from '../../core/world/world-manager.js';
import { clampLimit, type PostsService } from '../posts/posts.service.js';
import { searchRepo } from './search.repo.js';

export class SearchService {
  constructor(
    private readonly worldManager: WorldManager,
    private readonly postsService: PostsService,
  ) {}

  posts(query: string, viewerId: number | null, cursor?: string, limit?: number): Page<PostView> {
    const q = normalizeQuery(query);
    const { db } = this.worldManager.current();
    const pageSize = clampLimit(limit);
    const rows = searchRepo.searchPosts(db, q, parseIdCursor(cursor), pageSize + 1);
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
    const { db } = this.worldManager.current();
    const pageSize = clampLimit(limit);
    const rows = searchRepo.searchUsers(db, q, parseIdCursor(cursor), pageSize + 1);
    const hasMore = rows.length > pageSize;
    const items = hasMore ? rows.slice(0, pageSize) : rows;
    const last = items[items.length - 1];
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
