import type { System, Entity, TickContext } from '../ecs/types.js';
import type { ApiClient } from '../api-client.js';
import { logger } from '../logger.js';

interface Topic {
  id: number;
  title: string;
  heat: number;
  tags: string[];
}

export class PostingSystem implements System {
  name = 'PostingSystem';

  private topics: Topic[] = [];
  private scenePools: Record<string, string[]> = {};
  private topicPools: Record<string, string[]> = {};
  private lastPoolRefresh = 0;
  private readonly poolRefreshIntervalMs = 60_000;

  constructor(
    private api: ApiClient,
    private fallbackPool: string[],
    private adminToken: string,
  ) {}

  async update(entities: Entity[], ctx: TickContext): Promise<void> {
    await this.refreshPoolsIfNeeded(ctx);

    for (const entity of entities) {
      if (!entity.auth) continue;
      if (!this.shouldAct(entity, ctx)) continue;

      if (Math.random() < entity.behavior.postProbability) {
        await this.post(entity);
      }
    }
  }

  private async refreshPoolsIfNeeded(ctx: TickContext): Promise<void> {
    if (ctx.simTime - this.lastPoolRefresh < this.poolRefreshIntervalMs) return;
    try {
      const [topicsData, poolsData] = await Promise.all([
        this.api.getActiveTopics(this.adminToken),
        this.api.getContentPools(this.adminToken),
      ]);
      this.topics = topicsData.topics;
      this.scenePools = poolsData.scenePools;
      this.topicPools = poolsData.topicPools;
      this.lastPoolRefresh = ctx.simTime;
    } catch {
      // silent — use cached data
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
    const content = this.pickContent(entity);
    if (!content) return;

    try {
      const result = await this.api.createPost(entity.auth!.token, content);
      this.scheduleNext(entity);
      logger.info(`[${entity.profile.handle}] posted: "${content.slice(0, 50)}..." (id: ${result.id})`);
    } catch (err) {
      logger.error(`[${entity.profile.handle}] failed to post:`, err);
    }
  }

  private pickContent(entity: Entity): string | null {
    const topic = this.pickTopic(entity);

    if (topic) {
      const topicPool = this.topicPools[topic.title] ?? this.topicPools[String(topic.id)];
      if (topicPool && topicPool.length > 0) {
        const idx = Math.floor(Math.random() * topicPool.length);
        return topicPool[idx]!;
      }
    }

    const sceneKeys = Object.keys(this.scenePools);
    if (sceneKeys.length > 0) {
      const key = sceneKeys[Math.floor(Math.random() * sceneKeys.length)]!;
      const pool = this.scenePools[key]!;
      if (pool.length > 0) {
        const idx = Math.floor(Math.random() * pool.length);
        return pool[idx]!;
      }
    }

    if (this.fallbackPool.length > 0) {
      const idx = Math.floor(Math.random() * this.fallbackPool.length);
      return this.fallbackPool[idx]!;
    }

    return null;
  }

  private pickTopic(entity: Entity): Topic | null {
    if (this.topics.length === 0) return null;

    const weights = this.topics.map(t => {
      const interestMatch = t.tags.some(tag => entity.profile.interests.includes(tag));
      return t.heat * (interestMatch ? 3 : 1);
    });
    const total = weights.reduce((a, b) => a + b, 0);
    if (total === 0) return null;

    let roll = Math.random() * total;
    for (let i = 0; i < this.topics.length; i++) {
      roll -= weights[i]!;
      if (roll <= 0) return this.topics[i]!;
    }
    return this.topics[this.topics.length - 1]!;
  }

  private scheduleNext(entity: Entity): void {
    const jitter = 0.5 + Math.random();
    const intervalMs = entity.behavior.actionIntervalMinutes * 60_000 * jitter;
    entity.schedule.nextActionAt = Date.now() + intervalMs;
  }
}
