import type { Page, PostView } from '@socialsim/shared';
import { decodeTsIdCursor, encodeCursor } from '../../core/pagination.js';
import type { WorldManager } from '../../core/world/world-manager.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { clampLimit, type PostsService } from '../posts/posts.service.js';
import { interactionsRepo } from './interactions.repo.js';

export interface InteractionResult {
  active: boolean;
  count: number;
}

export class InteractionsService {
  constructor(
    private readonly worldManager: WorldManager,
    private readonly postsService: PostsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  like(viewerId: number, postId: number): InteractionResult {
    return this.set('likes', viewerId, postId, true);
  }

  unlike(viewerId: number, postId: number): InteractionResult {
    return this.set('likes', viewerId, postId, false);
  }

  repost(viewerId: number, postId: number): InteractionResult {
    return this.set('reposts', viewerId, postId, true);
  }

  unrepost(viewerId: number, postId: number): InteractionResult {
    return this.set('reposts', viewerId, postId, false);
  }

  /** 书签：私密（无计数、无通知），幂等开关 */
  bookmark(viewerId: number, postId: number): { active: boolean } {
    this.postsService.getLiveRow(postId);
    const { db, clock } = this.worldManager.current();
    interactionsRepo.insert(db, 'bookmarks', viewerId, postId, clock.now());
    return { active: true };
  }

  unbookmark(viewerId: number, postId: number): { active: boolean } {
    const { db } = this.worldManager.current();
    interactionsRepo.remove(db, 'bookmarks', viewerId, postId);
    return { active: false };
  }

  /** 隐藏帖（"不感兴趣"）：私密、无计数、无通知，被隐藏的帖从本人各内容流消失 */
  hide(viewerId: number, postId: number): { active: boolean } {
    this.postsService.getLiveRow(postId);
    const { db, clock } = this.worldManager.current();
    interactionsRepo.insert(db, 'hidden_posts', viewerId, postId, clock.now());
    return { active: true };
  }

  unhide(viewerId: number, postId: number): { active: boolean } {
    const { db } = this.worldManager.current();
    interactionsRepo.remove(db, 'hidden_posts', viewerId, postId);
    return { active: false };
  }

  listBookmarks(viewerId: number, cursor?: string, limit?: number): Page<PostView> {
    const { db } = this.worldManager.current();
    const pageSize = clampLimit(limit);
    const rows = interactionsRepo.listBookmarkedBy(db, viewerId, decodeTsIdCursor(cursor), pageSize + 1);
    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
    const last = pageRows[pageRows.length - 1];
    return {
      items: this.postsService.buildViews(pageRows, viewerId),
      nextCursor: hasMore && last ? encodeCursor([last.marked_at, last.id]) : null,
    };
  }

  /** 幂等开关：重复点赞/重复取消不报错也不重复计数 */
  private set(
    table: 'likes' | 'reposts',
    viewerId: number,
    postId: number,
    active: boolean,
  ): InteractionResult {
    const post = this.postsService.getLiveRow(postId);
    const { db, clock } = this.worldManager.current();
    const countField = table === 'likes' ? 'like' : 'repost';
    const notifyType = table === 'likes' ? 'like' : 'repost';

    db.transaction(() => {
      const changed = active
        ? interactionsRepo.insert(db, table, viewerId, postId, clock.now())
        : interactionsRepo.remove(db, table, viewerId, postId);
      if (!changed) return;
      this.postsService.adjustCounts(postId, { [countField]: active ? 1 : -1 });
      if (active) {
        this.notificationsService.add({
          userId: post.author_id,
          type: notifyType,
          actorId: viewerId,
          postId,
        });
      }
    })();

    const fresh = this.postsService.getLiveRow(postId);
    return {
      active,
      count: table === 'likes' ? fresh.like_count : fresh.repost_count,
    };
  }
}
