import type { InteractionEvent, Page, PostView } from '@socialsim/shared';
import { decodeCursor, decodeTsIdCursor, encodeCursor } from '../../core/pagination.js';
import type { WorldManager } from '../../core/world/world-manager.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { clampLimit, type PostsService } from '../posts/posts.service.js';
import type { UsersService } from '../users/users.service.js';
import { interactionsRepo } from './interactions.repo.js';

export interface InteractionResult {
  active: boolean;
  count: number;
}

function decodeActivityCursor(cursor?: string): { ts: number; kind: string; ref: number } | null {
  const parts = decodeCursor(cursor);
  if (!parts || parts.length !== 3) return null;
  const [ts, kind, ref] = parts;
  if (typeof ts !== 'number' || typeof kind !== 'string' || typeof ref !== 'number') return null;
  return { ts, kind, ref };
}

export class InteractionsService {
  constructor(
    private readonly worldManager: WorldManager,
    private readonly postsService: PostsService,
    private readonly notificationsService: NotificationsService,
    private readonly usersService: UsersService,
  ) {}

  /** 某账号的互动事件流（赞/转/关注），按互动时间倒序、游标分页——供编辑器时间轴把互动落到正确时刻。 */
  listUserActivity(
    handle: string,
    viewerId: number | null,
    cursor?: string,
    limit?: number,
    range?: { from?: number | undefined; to?: number | undefined },
  ): Page<InteractionEvent> {
    const profile = this.usersService.getProfileByHandle(handle);
    const { db } = this.worldManager.current();
    const pageSize = clampLimit(limit);
    const rows = interactionsRepo.listUserActivity(db, profile.id, decodeActivityCursor(cursor), pageSize + 1, range);
    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
    const items: InteractionEvent[] = [];
    for (const r of pageRows) {
      try {
        if (r.kind === 'follow') {
          const p = this.usersService.getProfileById(r.ref);
          items.push({ type: 'follow', at: r.created_at, target: { id: p.id, handle: p.handle, displayName: p.displayName, avatarUrl: p.avatarUrl, verified: p.verified } });
        } else {
          items.push({ type: r.kind, at: r.created_at, post: this.postsService.getView(r.ref, viewerId) });
        }
      } catch {
        // 被作用对象已不存在（硬删等），跳过该事件，不让整页崩。
      }
    }
    const last = pageRows[pageRows.length - 1];
    return { items, nextCursor: hasMore && last ? encodeCursor([last.created_at, last.kind, last.ref]) : null };
  }

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
