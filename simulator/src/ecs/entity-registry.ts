import type { Entity, AccountConfig } from './types.js';

export class EntityRegistry {
  private entities = new Map<string, Entity>();

  register(config: AccountConfig, userId: string): Entity {
    const entity: Entity = {
      id: userId,
      profile: {
        userId,
        handle: config.handle,
        displayName: config.handle,
        tier: config.tier,
        interests: config.interests ?? [],
      },
      schedule: {
        activeHoursStart: config.activeHoursStart ?? 0,
        activeHoursEnd: config.activeHoursEnd ?? 24,
        nextActionAt: 0,
        timezone: 0,
      },
      behavior: {
        postProbability: config.postProbability ?? (config.tier === 'core' ? 0.3 : 0.15),
        likeProbability: config.likeProbability ?? 0.5,
        repostProbability: config.repostProbability ?? 0.1,
        replyProbability: config.replyProbability ?? (config.tier === 'core' ? 0.2 : 0.05),
        actionIntervalMinutes: config.actionIntervalMinutes ?? (config.tier === 'core' ? 30 : 60),
      },
      emotion: {
        mood: 'neutral',
        intensity: 0.5,
      },
      topicInterest: {
        topicWeights: new Map(),
      },
    };
    this.entities.set(userId, entity);
    return entity;
  }

  get(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  getAll(): Entity[] {
    return [...this.entities.values()];
  }

  count(): number {
    return this.entities.size;
  }
}
