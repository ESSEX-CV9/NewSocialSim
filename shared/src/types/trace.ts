/**
 * 决策轨迹事件：模拟器每次写世界（发帖/回复/引用/赞/转/关注）吐一条，
 * 记录"为什么这么做"，落盘为 per-world 的 sim-trace.db（模拟器独占，不进 world.db）。
 * 同时记 at（现实时间）与 simTime（世界模拟时间）：现实时间供追溯动作在现实里何时发生，
 * 世界时间供对齐到时间轴。
 */

export type SimTraceAction = 'post' | 'reply' | 'quote' | 'like' | 'repost' | 'follow';

/** 内容形态。standalone=顶层帖，reply=回复，quote=引用。 */
export type SimTraceShape = 'standalone' | 'reply' | 'quote';

export interface SimTraceEvent {
  /** 现实时间（unix 毫秒）。 */
  at: number;
  /** 世界模拟时间（unix 毫秒形态）。 */
  simTime: number;
  /** 驱动账号 handle。 */
  entity: string;
  action: SimTraceAction;
  /** 当前活动状态（状态机阶段填真值，先确定性阶段为占位）。 */
  activityState?: string | null;
  /** 粗粒度意图（earnest/mock/... ；先确定性阶段为占位）。 */
  intent?: string | null;
  /** 内容形态；like/repost/follow 等非内容动作为 null。 */
  shape?: SimTraceShape | null;
  /** 命中的池 id（内容池 ECS 阶段填，先确定性阶段可为 null）。 */
  poolId?: string | null;
  /** 池内所选条目/语法标识（内容池 ECS 阶段填）。 */
  entryId?: string | null;
  mediaAttached?: boolean;
  /** 配图/不配图的原因（配图阶段填）。 */
  mediaReason?: string | null;
  /** reply/quote/like/repost 时为被作用帖 id；其余为 null。 */
  targetPostId?: string | null;
}

/**
 * GM/Agent 决策日志：导演层/Agent"为什么这么调度"的观测记录，与决策轨迹同属观测线，
 * 同库（sim-trace.db）独立表存放，绝不进 world.db。
 * 同记 at（现实时间，供追溯每次 LLM 调用在现实里何时发生）与 simTime（世界时间，供对齐时间轴）。
 * 先确定性阶段无 LLM 运行，此结构与表先建好"家"、暂无写入，待 LLM 行为层/GM 导演层接入。
 */
export interface GmAgentLogEvent {
  /** 现实时间（unix 毫秒）。 */
  at: number;
  /** 世界模拟时间（unix 毫秒形态）。 */
  simTime: number;
  kind: 'gm' | 'agent';
  /** 任务标签（如 make-hot-thread / npc-post）。 */
  taskLabel?: string | null;
  /** 本轮决策摘要（GM 写回日志的连续性凭据）。 */
  summary?: string | null;
  /** 结构化明细（工具调用链 / 步数 / token 等），存 JSON 文本。 */
  detail?: string | null;
}
