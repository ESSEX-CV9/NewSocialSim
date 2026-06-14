import type { WorldManager } from '../../core/world/world-manager.js';
import { ValidationError, NotFoundError } from '../../core/errors/app-error.js';
import { postsRepo } from '../posts/posts.repo.js';
import { followsRepo } from '../follows/follows.repo.js';

export class AdminService {
  constructor(private readonly worldManager: WorldManager) {}

  async createPost(input: {
    authorId: number;
    content: string;
    createdAt?: number;
    replyToId?: number;
    quoteOfId?: number;
  }): Promise<{ id: number }> {
    const { db, clock } = this.worldManager.current();

    const content = (input.content ?? '').trim();
    if (!content) throw new ValidationError('content is required');

    const authorExists = db
      .prepare('SELECT 1 FROM users WHERE id = ?')
      .get(input.authorId);
    if (!authorExists) throw new NotFoundError(`User ${input.authorId} not found`);

    const createdAt = input.createdAt ?? clock.now();

    if (input.replyToId) {
      const parent = postsRepo.findById(db, input.replyToId);
      if (!parent) throw new NotFoundError(`Parent post ${input.replyToId} not found`);
    }

    if (input.quoteOfId) {
      const quoted = postsRepo.findById(db, input.quoteOfId);
      if (!quoted) throw new NotFoundError(`Quoted post ${input.quoteOfId} not found`);
    }

    const postId = db.transaction(() => {
      const id = postsRepo.insert(db, {
        authorId: input.authorId,
        content,
        replyToId: input.replyToId ?? null,
        quoteOfId: input.quoteOfId ?? null,
        createdAt,
      });

      if (input.replyToId) {
        db.prepare('UPDATE posts SET reply_count = reply_count + 1 WHERE id = ?')
          .run(input.replyToId);
      }
      if (input.quoteOfId) {
        db.prepare('UPDATE posts SET quote_count = quote_count + 1 WHERE id = ?')
          .run(input.quoteOfId);
      }

      return id;
    })();

    return { id: postId };
  }

  bulkFollow(pairs: Array<{ followerId: number; followeeId: number }>): { created: number } {
    const { db, clock } = this.worldManager.current();
    const now = clock.now();
    let created = 0;

    db.transaction(() => {
      for (const { followerId, followeeId } of pairs) {
        if (followerId === followeeId) continue;
        const ok = followsRepo.insert(db, followerId, followeeId, now);
        if (ok) created++;
      }
    })();

    return { created };
  }

  updateCounts(postId: number, deltas: {
    likeCount?: number;
    repostCount?: number;
    replyCount?: number;
    viewCount?: number;
  }): void {
    const { db } = this.worldManager.current();

    const post = postsRepo.findById(db, postId);
    if (!post) throw new NotFoundError(`Post ${postId} not found`);

    const sets: string[] = [];
    const params: number[] = [];

    if (deltas.likeCount) { sets.push('like_count = like_count + ?'); params.push(deltas.likeCount); }
    if (deltas.repostCount) { sets.push('repost_count = repost_count + ?'); params.push(deltas.repostCount); }
    if (deltas.replyCount) { sets.push('reply_count = reply_count + ?'); params.push(deltas.replyCount); }
    if (deltas.viewCount) { sets.push('view_count = view_count + ?'); params.push(deltas.viewCount); }

    if (sets.length === 0) return;

    db.prepare(`UPDATE posts SET ${sets.join(', ')} WHERE id = ?`).run(...params, postId);
  }

  getSimulatorStatus(): {
    running: boolean;
    tickNumber: number;
    entityCount: number;
    uptime: number;
    recentActions: Array<{ time: string; actor: string; action: string; detail: string }>;
  } {
    return {
      running: false,
      tickNumber: 0,
      entityCount: 0,
      uptime: 0,
      recentActions: [],
    };
  }
}
