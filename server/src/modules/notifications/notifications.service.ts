import type { NotificationType, NotificationView, Page, VerifiedType } from '@socialsim/shared';
import { decodeCursor, encodeCursor } from '../../core/pagination.js';
import type { WorldManager } from '../../core/world/world-manager.js';
import { mediaFileUrl } from '../media/media.service.js';
import { notificationsRepo, type NotificationRow } from './notifications.repo.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export class NotificationsService {
  constructor(private readonly worldManager: WorldManager) {}

  /** 供 posts/interactions/follows 调用；对自己的操作不产生通知 */
  add(input: { userId: number; type: NotificationType; actorId: number; postId?: number }): void {
    if (input.userId === input.actorId) return;
    const { db, clock } = this.worldManager.current();
    notificationsRepo.insert(db, {
      userId: input.userId,
      type: input.type,
      actorId: input.actorId,
      postId: input.postId ?? null,
      createdAt: clock.now(),
    });
  }

  list(
    userId: number,
    filter: 'all' | 'mentions' = 'all',
    cursor?: string,
    limit?: number,
  ): Page<NotificationView> {
    const { db, worldId } = this.worldManager.current();
    const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, limit ?? DEFAULT_PAGE_SIZE));
    const beforeId = parseIdCursor(cursor);
    const rows = notificationsRepo.list(db, userId, filter === 'mentions', beforeId, pageSize + 1);
    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
    const last = pageRows[pageRows.length - 1];
    return {
      items: pageRows.map((r) => toView(r, worldId)),
      nextCursor: hasMore && last ? encodeCursor([last.id]) : null,
    };
  }

  unreadCount(userId: number): number {
    const { db } = this.worldManager.current();
    return notificationsRepo.unreadCount(db, userId);
  }

  markAllRead(userId: number): void {
    const { db } = this.worldManager.current();
    notificationsRepo.markAllRead(db, userId);
  }

  markRead(userId: number, ids: number[]): void {
    const { db } = this.worldManager.current();
    notificationsRepo.markRead(db, userId, ids);
  }
}

const EXCERPT_LENGTH = 100;

function toView(row: NotificationRow, worldId: string): NotificationView {
  return {
    id: row.id,
    type: row.type,
    actor: {
      id: row.actor_id,
      handle: row.actor_handle,
      displayName: row.actor_display_name,
      isBot: row.actor_is_bot === 1,
      avatarUrl: mediaFileUrl(row.actor_avatar_media_id, worldId),
      verified: row.actor_verified as VerifiedType,
    },
    actorFollowerCount: row.actor_follower_count,
    actorFollowedByViewer: row.actor_followed === 1,
    postId: row.post_id,
    postExcerpt:
      row.post_content !== null && row.post_deleted === 0
        ? row.post_content.slice(0, EXCERPT_LENGTH)
        : null,
    read: row.read === 1,
    createdAt: row.created_at,
  };
}

function parseIdCursor(cursor: string | undefined): number | null {
  const parts = decodeCursor(cursor);
  return parts && parts.length === 1 && typeof parts[0] === 'number' ? parts[0] : null;
}
