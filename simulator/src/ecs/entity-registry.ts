import type { Entity, DrivenAccount } from './types.js';

export class EntityRegistry {
  private entities = new Map<string, Entity>();

  register(account: DrivenAccount): Entity {
    const entity: Entity = {
      id: account.userId,
      profile: {
        userId: account.userId,
        handle: account.handle,
        displayName: account.displayName,
        tier: account.tier,
        interests: account.interests,
        ...(account.factions !== undefined ? { factions: account.factions } : {}),
        ...(account.poolAffinities !== undefined ? { poolAffinities: account.poolAffinities } : {}),
        ...(account.personality !== undefined ? { personality: account.personality } : {}),
        ...(account.stance !== undefined ? { stance: account.stance } : {}),
        ...(account.writingStyle !== undefined ? { writingStyle: account.writingStyle } : {}),
      },
      schedule: {
        activeHoursStart: account.activeHoursStart,
        activeHoursEnd: account.activeHoursEnd,
        nextActionAt: 0,
        timezone: 0,
      },
      behavior: {
        postProbability: account.postProbability,
        likeProbability: account.likeProbability,
        repostProbability: account.repostProbability,
        replyProbability: account.replyProbability,
        actionIntervalMinutes: account.actionIntervalMinutes,
      },
      emotion: {
        mood: 'neutral',
        intensity: 0.5,
      },
      topicInterest: {
        topicWeights: new Map(),
      },
    };
    this.entities.set(account.userId, entity);
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
