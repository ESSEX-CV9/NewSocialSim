import type { System, Entity, TickContext } from '../ecs/types.js';
import type { ApiClient } from '../api-client.js';
import { logger } from '../logger.js';

interface Topic {
  id: number;
  title: string;
  heat: number;
  tags: string[];
}

/**
 * 顶层发帖系统（确定性，零 LLM）。账号到点按概率从内容池取文发顶层帖。
 * 先确定性后 LLM：Step 0/1 一律走模板/池路径，LLM Agent 路径暂不接入关键链路。
 * 内容池当前仍是扁平 string[]（scene/topic），Step 1 替换为 ECS 组件/语法/池模型。
 */
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
        await this.post(entity, ctx);
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

  private async post(entity: Entity, ctx: TickContext): Promise<void> {
    const content = this.pickContent(entity);
    if (!content) {
      this.scheduleNext(entity, ctx);
      return;
    }

    try {
      const result = await this.api.createPost(entity.auth!.token, content);
      logger.info(`[${entity.profile.handle}] posted: "${content.slice(0, 40)}" (id ${result.id})`);
    } catch (err) {
      logger.error(`[${entity.profile.handle}] post failed:`, err);
    }
    this.scheduleNext(entity, ctx);
  }

  private pickContent(entity: Entity): string | null {
    const topic = this.pickTopic(entity);

    if (topic) {
      const topicPool = this.topicPools[topic.title] ?? this.topicPools[String(topic.id)];
      if (topicPool && topicPool.length > 0) {
        return topicPool[Math.floor(Math.random() * topicPool.length)]!;
      }
    }

    const sceneKeys = Object.keys(this.scenePools);
    if (sceneKeys.length > 0) {
      const key = sceneKeys[Math.floor(Math.random() * sceneKeys.length)]!;
      const pool = this.scenePools[key]!;
      if (pool.length > 0) {
        return pool[Math.floor(Math.random() * pool.length)]!;
      }
    }

    if (this.fallbackPool.length > 0) {
      return this.fallbackPool[Math.floor(Math.random() * this.fallbackPool.length)]!;
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

  private scheduleNext(entity: Entity, ctx: TickContext): void {
    const jitter = 0.5 + Math.random();
    const intervalMs = entity.behavior.actionIntervalMinutes * 60_000 * jitter;
    entity.schedule.nextActionAt = ctx.simTime + intervalMs;
  }
}
