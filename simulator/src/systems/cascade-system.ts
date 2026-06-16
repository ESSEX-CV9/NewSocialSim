import type { System, Entity, TickContext } from '../ecs/types.js';
import type { ApiClient } from '../api-client.js';
import type { TraceSink } from '../trace/trace-sink.js';
import { logger } from '../logger.js';

interface PendingReaction {
  entityId: string;
  postId: string;
  postAuthorHandle: string;
  triggerAt: number;
  depth: number;
}

const MAX_CASCADE_DEPTH = 3;
const DECAY_PER_LEVEL = 0.5;

export class CascadeSystem implements System {
  name = 'CascadeSystem';

  private pending: PendingReaction[] = [];
  private processedPosts = new Set<string>();
  private lastScanTime = 0;
  private readonly scanIntervalMs = 15_000;

  constructor(
    private api: ApiClient,
    private entityMap: Map<string, Entity>,
    private replyPool: string[],
    private trace: TraceSink,
  ) {}

  async update(entities: Entity[], ctx: TickContext): Promise<void> {
    if (ctx.simTime - this.lastScanTime > this.scanIntervalMs) {
      await this.scanNewPosts(entities, ctx);
      this.lastScanTime = ctx.simTime;
    }

    await this.processReactions(ctx);
  }

  private async scanNewPosts(entities: Entity[], ctx: TickContext): Promise<void> {
    for (const entity of entities) {
      if (!entity.auth) continue;

      try {
        const timeline = await this.api.getTimeline(entity.auth.token, 5);
        for (const item of timeline.items) {
          const post = item.post ?? item;
          if (!post.author) continue;

          const postKey = `${entity.id}:${post.id}`;
          if (this.processedPosts.has(postKey)) continue;
          this.processedPosts.add(postKey);

          if (post.author.id === entity.profile.userId) continue;

          const delay = (30 + Math.random() * 120) * 1000;
          this.pending.push({
            entityId: entity.id,
            postId: post.id,
            postAuthorHandle: post.author.handle,
            triggerAt: ctx.simTime + delay,
            depth: 0,
          });
        }
      } catch {
        // silent
      }
    }

    if (this.processedPosts.size > 5000) {
      const arr = [...this.processedPosts];
      this.processedPosts = new Set(arr.slice(-2000));
    }
  }

  private async processReactions(ctx: TickContext): Promise<void> {
    const ready = this.pending.filter(r => r.triggerAt <= ctx.simTime);
    this.pending = this.pending.filter(r => r.triggerAt > ctx.simTime);

    for (const reaction of ready) {
      const entity = this.entityMap.get(reaction.entityId);
      if (!entity?.auth) continue;

      const depthMultiplier = Math.pow(DECAY_PER_LEVEL, reaction.depth);

      if (Math.random() < entity.behavior.likeProbability * 0.4 * depthMultiplier) {
        try {
          await this.api.likePost(entity.auth.token, reaction.postId);
          logger.info(`[${entity.profile.handle}] cascade-liked post ${reaction.postId} by @${reaction.postAuthorHandle}`);
          this.trace.emit({
            at: Date.now(), simTime: ctx.simTime, entity: entity.profile.handle,
            action: 'like', shape: null, targetPostId: reaction.postId,
          });
        } catch { /* already liked or error */ }
      }

      if (Math.random() < entity.behavior.repostProbability * 0.3 * depthMultiplier) {
        try {
          await this.api.repost(entity.auth.token, reaction.postId);
          logger.info(`[${entity.profile.handle}] cascade-reposted post ${reaction.postId}`);
          this.trace.emit({
            at: Date.now(), simTime: ctx.simTime, entity: entity.profile.handle,
            action: 'repost', shape: null, targetPostId: reaction.postId,
          });
        } catch { /* already reposted or error */ }
      }

      if (reaction.depth < MAX_CASCADE_DEPTH && Math.random() < entity.behavior.replyProbability * depthMultiplier) {
        const replyContent = this.pickReply();
        if (replyContent) {
          try {
            const reply = await this.api.createPost(entity.auth.token, replyContent, reaction.postId);
            logger.info(`[${entity.profile.handle}] cascade-replied to post ${reaction.postId}: "${replyContent.slice(0, 30)}..."`);
            this.trace.emit({
              at: Date.now(), simTime: ctx.simTime, entity: entity.profile.handle,
              action: 'reply', shape: 'reply', intent: 'earnest', targetPostId: reaction.postId,
            });

            this.triggerCascadeForReply(reply.id, entity, ctx, reaction.depth + 1);
          } catch (err) {
            logger.error(`[${entity.profile.handle}] cascade-reply failed:`, err);
          }
        }
      }
    }
  }

  private triggerCascadeForReply(replyId: string, author: Entity, ctx: TickContext, depth: number): void {
    if (depth >= MAX_CASCADE_DEPTH) return;

    for (const [, entity] of this.entityMap) {
      if (entity.id === author.id) continue;
      if (!entity.auth) continue;
      if (Math.random() > 0.3) continue;

      const delay = (60 + Math.random() * 180) * 1000;
      this.pending.push({
        entityId: entity.id,
        postId: replyId,
        postAuthorHandle: author.profile.handle,
        triggerAt: ctx.simTime + delay,
        depth,
      });
    }
  }

  private pickReply(): string | null {
    if (this.replyPool.length === 0) return null;
    return this.replyPool[Math.floor(Math.random() * this.replyPool.length)]!;
  }
}
