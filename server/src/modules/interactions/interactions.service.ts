import type { WorldManager } from '../../core/world/world-manager.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { PostsService } from '../posts/posts.service.js';
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
