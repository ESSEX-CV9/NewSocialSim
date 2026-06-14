import type { System, Entity, TickContext } from '../ecs/types.js';
import type { ApiClient } from '../api-client.js';
import { logger } from '../logger.js';

export class InteractionSystem implements System {
  name = 'InteractionSystem';

  constructor(private api: ApiClient) {}

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

      await this.browseAndInteract(entity);
    }
  }

  private async browseAndInteract(entity: Entity): Promise<void> {
    try {
      const timeline = await this.api.getTimeline(entity.auth!.token, 10);
      if (!timeline.items.length) return;

      for (const item of timeline.items) {
        const post = item.post ?? item;
        if (!post.author) continue;
        if (post.author.id === entity.profile.userId) continue;
        if (post.likedByViewer) continue;

        if (Math.random() < entity.behavior.likeProbability * 0.3) {
          await this.api.likePost(entity.auth!.token, post.id);
          logger.info(`[${entity.profile.handle}] liked post ${post.id} by @${post.author.handle}`);
        }

        if (Math.random() < entity.behavior.repostProbability * 0.3) {
          await this.api.repost(entity.auth!.token, post.id);
          logger.info(`[${entity.profile.handle}] reposted post ${post.id} by @${post.author.handle}`);
          break;
        }
      }
    } catch (err) {
      logger.error(`[${entity.profile.handle}] interaction failed:`, err);
    }
  }
}
