/**
 * ECS type definitions for the simulator.
 * Entity = a driven account, Components = data attached to it,
 * Systems = logic that operates on entities each tick.
 */

export interface ProfileComponent {
  userId: string;
  handle: string;
  displayName: string;
  tier: 'core' | 'ambient';
  personality?: string;
  stance?: string;
  writingStyle?: string;
  interests: string[];
}

export interface ScheduleComponent {
  activeHoursStart: number;
  activeHoursEnd: number;
  nextActionAt: number;
  timezone: number;
}

export interface BehaviorComponent {
  postProbability: number;
  likeProbability: number;
  repostProbability: number;
  replyProbability: number;
  /** Average minutes between actions when online */
  actionIntervalMinutes: number;
}

export interface EmotionComponent {
  mood: 'neutral' | 'happy' | 'angry' | 'sad' | 'excited';
  intensity: number;
}

export interface TopicInterestComponent {
  topicWeights: Map<string, number>;
}

export interface AuthComponent {
  token: string;
  expiresAt: number;
}

export interface Entity {
  id: string;
  profile: ProfileComponent;
  schedule: ScheduleComponent;
  behavior: BehaviorComponent;
  emotion: EmotionComponent;
  topicInterest: TopicInterestComponent;
  auth?: AuthComponent;
}

export interface System {
  name: string;
  update(entities: Entity[], context: TickContext): Promise<void>;
}

export interface TickContext {
  simTime: number;
  tickNumber: number;
  deltaMs: number;
}

export interface SimulatorConfig {
  apiBaseUrl: string;
  worldId: string;
  tickIntervalMs: number;
  accounts: AccountConfig[];
  contentPool: string[];
}

export interface AccountConfig {
  handle: string;
  password: string;
  tier: 'core' | 'ambient';
  interests?: string[];
  activeHoursStart?: number;
  activeHoursEnd?: number;
  postProbability?: number;
  likeProbability?: number;
  repostProbability?: number;
  replyProbability?: number;
  actionIntervalMinutes?: number;
}
