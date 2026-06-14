import type { System, Entity, TickContext } from '../ecs/types.js';
import type { ApiClient } from '../api-client.js';
import { logger } from '../logger.js';

export class PostingSystem implements System {
  name = 'PostingSystem';

  constructor(
    private api: ApiClient,
    private contentPool: string[],
  ) {}

  async update(entities: Entity[], ctx: TickContext): Promise<void> {
    for (const entity of entities) {
      if (!entity.auth) continue;
      if (!this.shouldAct(entity, ctx)) continue;

      if (Math.random() < entity.behavior.postProbability) {
        await this.post(entity);
      }
    }
  }

  private shouldAct(entity: Entity, ctx: TickContext): boolean {
    if (ctx.simTime < entity.schedule.nextActionAt) return false;

    const { activeHoursStart, activeHoursEnd } = entity.schedule;
    if (activeHoursStart === 0 && activeHoursEnd === 24) return true;

    const hour = new Date(ctx.simTime).getHours();

    if (activeHoursStart <= activeHoursEnd) {
      if (hour < activeHoursStart || hour >= activeHoursEnd) return false;
    } else {
      if (hour < activeHoursStart && hour >= activeHoursEnd) return false;
    }

    return true;
  }

  private async post(entity: Entity): Promise<void> {
    if (this.contentPool.length === 0) return;

    const idx = Math.floor(Math.random() * this.contentPool.length);
    const content = this.contentPool[idx]!;

    try {
      const result = await this.api.createPost(entity.auth!.token, content);
      this.scheduleNext(entity);
      logger.info(`[${entity.profile.handle}] posted: "${content.slice(0, 50)}..." (id: ${result.id})`);
    } catch (err) {
      logger.error(`[${entity.profile.handle}] failed to post:`, err);
    }
  }

  private scheduleNext(entity: Entity): void {
    const jitter = 0.5 + Math.random();
    const intervalMs = entity.behavior.actionIntervalMinutes * 60_000 * jitter;
    entity.schedule.nextActionAt = Date.now() + intervalMs;
  }
}
