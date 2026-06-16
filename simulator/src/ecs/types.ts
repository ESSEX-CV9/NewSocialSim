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

/** 模拟器启动配置：只含与世界无关的基础设施，不含任何特定世界的数据。
 *  worldId / 账号名单 / 内容池均随活动世界从世界文件夹加载，不写在这里。 */
export interface SimulatorConfig {
  apiBaseUrl: string;
  adminToken: string;
  tickIntervalMs: number;
  /** 世界数据根目录（基础设施配置，与具体世界无关）。决策轨迹库写在
   *  `${dataDir}/worlds/<id>/sim-trace.db`。默认 repoRoot/data，可经 SOCIALSIM_DATA_DIR 覆盖。 */
  dataDir: string;
}

/** 一个被驱动账号的完整配置，来自活动世界的 npc 档案。 */
export interface DrivenAccount {
  userId: string;
  handle: string;
  displayName: string;
  tier: 'core' | 'ambient';
  interests: string[];
  personality?: string;
  stance?: string;
  writingStyle?: string;
  activeHoursStart: number;
  activeHoursEnd: number;
  postProbability: number;
  likeProbability: number;
  repostProbability: number;
  replyProbability: number;
  actionIntervalMinutes: number;
}
