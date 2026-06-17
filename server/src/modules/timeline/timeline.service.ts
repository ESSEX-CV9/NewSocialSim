import type { Page, TimelineItem, VerifiedType } from '@socialsim/shared';
import { decodeCursor, decodeTsIdCursor, encodeCursor } from '../../core/pagination.js';
import type { WorldManager } from '../../core/world/world-manager.js';
import { mediaFileUrl } from '../media/media.service.js';
import type { UsersService } from '../users/users.service.js';
import { clampLimit, type PostsService } from '../posts/posts.service.js';
import { timelineRepo, type TimelineEntryRow } from './timeline.repo.js';

export type HomeSort = 'latest' | 'hot';

function decodeScoreIdCursor(cursor: string | undefined): { score: number; id: number } | null {
  const parts = decodeCursor(cursor);
  if (!parts || parts.length !== 2) return null;
  const [score, id] = parts;
  if (typeof score !== 'number' || typeof id !== 'number') return null;
  return { score, id };
}

export class TimelineService {
  constructor(
    private readonly worldManager: WorldManager,
    private readonly postsService: PostsService,
    private readonly usersService: UsersService,
  ) {}

  home(viewerId: number, sort: HomeSort, cursor?: string, limit?: number): Page<TimelineItem> {
    const { db, clock } = this.worldManager.current();
    const pageSize = clampLimit(limit);
    if (sort === 'hot') {
      const rows = timelineRepo.homeHotEntries(
        db,
        viewerId,
        clock.now(),
        decodeScoreIdCursor(cursor),
        pageSize + 1,
      );
      return this.toHotPage(rows, pageSize, viewerId);
    }
    const rows = timelineRepo.homeLatestEntries(db, viewerId, decodeTsIdCursor(cursor), pageSize + 1);
    return this.toPage(rows, pageSize, viewerId);
  }

  forYou(viewerId: number | null, cursor?: string, limit?: number): Page<TimelineItem> {
    const { db, clock } = this.worldManager.current();
    const pageSize = clampLimit(limit);
    const rows = timelineRepo.forYouEntries(db, viewerId, clock.now(), decodeScoreIdCursor(cursor), pageSize + 1);
    return this.toHotPage(rows, pageSize, viewerId);
  }

  global(
    viewerId: number | null,
    cursor?: string,
    limit?: number,
    range?: { from?: number | undefined; to?: number | undefined },
  ): Page<TimelineItem> {
    const { db } = this.worldManager.current();
    const pageSize = clampLimit(limit);
    const rows = timelineRepo.globalEntries(db, viewerId, decodeTsIdCursor(cursor), pageSize + 1, range);
    return this.toPage(rows, pageSize, viewerId);
  }

  /** 个人主页"帖子"Tab：本人原创帖 + 本人转发 */
  user(handle: string, viewerId: number | null, cursor?: string, limit?: number): Page<TimelineItem> {
    const profile = this.usersService.getProfileByHandle(handle);
    const { db } = this.worldManager.current();
    const pageSize = clampLimit(limit);
    const rows = timelineRepo.userEntries(db, profile.id, profile.pinnedPostId, decodeTsIdCursor(cursor), pageSize + 1);
    return this.toPage(rows, pageSize, viewerId);
  }

  private buildItems(rows: TimelineEntryRow[], viewerId: number | null): TimelineItem[] {
    const { worldId } = this.worldManager.current();
    const views = this.postsService.getViewsByIds(
      [...new Set(rows.map((r) => r.post_id))],
      viewerId,
    );
    const items: TimelineItem[] = [];
    for (const row of rows) {
      const post = views.get(row.post_id);
      if (!post) continue;
      items.push({
        type: row.item_type,
        post,
        repostedBy:
          row.item_type === 'repost' && row.actor_id !== null
            ? {
                id: row.actor_id,
                handle: row.actor_handle ?? '',
                displayName: row.actor_display_name ?? '',
                avatarUrl: mediaFileUrl(row.actor_avatar_media_id, worldId),
                verified: (row.actor_verified ?? 'none') as VerifiedType,
              }
            : null,
        activityAt: row.activity_at,
      });
    }
    return items;
  }

  private toPage(rows: TimelineEntryRow[], pageSize: number, viewerId: number | null): Page<TimelineItem> {
    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
    const last = pageRows[pageRows.length - 1];
    return {
      items: this.buildItems(pageRows, viewerId),
      nextCursor: hasMore && last ? encodeCursor([last.activity_at, last.post_id]) : null,
    };
  }

  private toHotPage(
    rows: (TimelineEntryRow & { score: number })[],
    pageSize: number,
    viewerId: number | null,
  ): Page<TimelineItem> {
    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
    const last = pageRows[pageRows.length - 1];
    return {
      items: this.buildItems(pageRows, viewerId),
      nextCursor: hasMore && last ? encodeCursor([last.score, last.post_id]) : null,
    };
  }
}
