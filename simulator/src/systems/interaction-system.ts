import type { System, Entity, TickContext } from '../ecs/types.js';
import type { ApiClient } from '../api-client.js';
import type { TraceSink } from '../trace/trace-sink.js';
import { idStr } from '../ids.js';
import { logger } from '../logger.js';

export class InteractionSystem implements System {
  name = 'InteractionSystem';

  constructor(private api: ApiClient, private trace: TraceSink) {}

  async update(entities: Entity[], ctx: TickContext): Promise<void> {
    for (const entity of entities) {
      if (!entity.auth) continue;

      const { activeHoursStart, activeHoursEnd } = entity.schedule;
      if (!(activeHoursStart === 0 && activeHoursEnd === 24)) {
        const hour = new Date(ctx.simTime).getHours();
        if (activeHoursStart <= activeHoursEnd) {
          if (hour < activeHoursStart || hour >= activeHoursEnd) continue;
        } else {
          if (hour < activeHoursStart && hour >= activeHoursEnd) continue;
        }
      }

      if (Math.random() > 0.3) continue;

      await this.browseAndInteract(entity, ctx);
    }
  }

  private async browseAndInteract(entity: Entity, ctx: TickContext): Promise<void> {
    try {
      const timeline = await this.api.getTimeline(entity.auth!.token, 10);
      if (!timeline.items.length) return;

      for (const item of timeline.items) {
        const post = item.post ?? item;
        if (!post.author) continue;
        if (post.author.id === entity.profile.userId) continue;
        if (post.likedByViewer) continue;

        const pid = idStr(post.id);

        if (Math.random() < entity.behavior.likeProbability * 0.3) {
          await this.api.likePost(entity.auth!.token, pid);
          logger.info(`[${entity.profile.handle}] liked post ${pid} by @${post.author.handle}`);
          this.trace.emit({
            at: Date.now(), simTime: ctx.simTime, entity: entity.profile.handle,
            action: 'like', shape: null, targetPostId: pid,
          });
        }

        if (Math.random() < entity.behavior.repostProbability * 0.3) {
          await this.api.repost(entity.auth!.token, pid);
          logger.info(`[${entity.profile.handle}] reposted post ${pid} by @${post.author.handle}`);
          this.trace.emit({
            at: Date.now(), simTime: ctx.simTime, entity: entity.profile.handle,
            action: 'repost', shape: null, targetPostId: pid,
          });
          break;
        }
      }
    } catch (err) {
      logger.error(`[${entity.profile.handle}] interaction failed:`, err);
    }
  }
}
