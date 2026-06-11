import type { Page, TimelineItem } from '@socialsim/shared';
import { decodeTsIdCursor, encodeCursor } from '../../core/pagination.js';
import type { WorldManager } from '../../core/world/world-manager.js';
import { clampLimit, type PostsService } from '../posts/posts.service.js';
import { timelineRepo, type TimelineEntryRow } from './timeline.repo.js';

export class TimelineService {
  constructor(
    private readonly worldManager: WorldManager,
    private readonly postsService: PostsService,
  ) {}

  home(viewerId: number, cursor?: string, limit?: number): Page<TimelineItem> {
    const { db } = this.worldManager.current();
    const pageSize = clampLimit(limit);
    const rows = timelineRepo.homeEntries(db, viewerId, decodeTsIdCursor(cursor), pageSize + 1);
    return this.toPage(rows, pageSize, viewerId);
  }

  global(viewerId: number | null, cursor?: string, limit?: number): Page<TimelineItem> {
    const { db } = this.worldManager.current();
    const pageSize = clampLimit(limit);
    const rows = timelineRepo.globalEntries(db, decodeTsIdCursor(cursor), pageSize + 1);
    return this.toPage(rows, pageSize, viewerId);
  }

  private toPage(
    rows: TimelineEntryRow[],
    pageSize: number,
    viewerId: number | null,
  ): Page<TimelineItem> {
    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
    const views = this.postsService.getViewsByIds(
      [...new Set(pageRows.map((r) => r.post_id))],
      viewerId,
    );

    const items: TimelineItem[] = [];
    for (const row of pageRows) {
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
                isBot: row.actor_is_bot === 1,
              }
            : null,
        activityAt: row.activity_at,
      });
    }

    const last = pageRows[pageRows.length - 1];
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor([last.activity_at, last.post_id]) : null,
    };
  }
}
