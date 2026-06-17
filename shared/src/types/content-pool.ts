/**
 * 内容池 ECS 三层模型（顶层帖内容池，见 docs/m5-x-re-plan.md「内容池模型」、
 * docs/m5-npc-state-machine.md「内容池架构」）。
 *
 * 不存整句，存可组装片段，组织方式与模拟器 ECS 同构：
 *   组件类型（Component，自带候选片段） → 语法（Archetype，有序引用一批组件类型） → 池（维度 + 引用哪几套语法）。
 * 生成一条内容 = 按池选一套语法 → 逐组件各取一个片段填充 → 解析内联占位符。
 * 组件类型库与语法库均为可跨池复用的注册表，按「全局共享 / 世界级」两层存放（全局层入 git）。
 *
 * 本文件只定义结构与加载结果形态；按池组装（选语法 / 加权抽片段 / 解占位符）属 1.2 组装引擎。
 */

/** 内容形态（全局固定维度的取值）。standalone=顶层帖，reply=回复，quote=引用。 */
export type PoolShape = 'standalone' | 'reply' | 'quote';

/** 篇幅（独立维度的取值）。确定性池只产这两档（生成方式不同）。 */
export type PoolLength = 'short' | 'long';

/** 约定维度键：形态为全局固定维度、篇幅为独立维度；其余维度键由各世界自定义（如 作品 / 领域 / 模式）。 */
export const POOL_DIM_SHAPE = '形态';
export const POOL_DIM_LENGTH = '篇幅';

/**
 * 片段：某组件类型候选库里的一条。text 可含占位符 `{key}` / `{key:variant}`（内联组件引用）。
 * 其余字段为可选过滤 / 加权标签（缺省 = 任意），供组装的选择算法用（1.2 起消费）。
 */
export interface Fragment {
  text: string;
  /** 仅当说话人 factions 命中其一时可选。 */
  speakerFaction?: string[];
  /** 仅当互动目标 factions 命中其一时可选（Beefing 必对上）。 */
  targetFaction?: string[];
  /** 软权重：与说话人 alignment 的偏好匹配。 */
  preferredAlignment?: { lawfulness?: number; morality?: number; tolerance?: number };
  /** 仅在这些话题语境触发。 */
  topics?: string[];
  register?: 'slang' | 'casual' | 'formal';
  energyLevel?: 'low' | 'mid' | 'high';
}

/** 组件类型库：组件类型名 → 候选片段列表。可跨池复用。 */
export type ComponentRegistry = Record<string, Fragment[]>;

/**
 * 语法的一个槽：引用一个组件类型，可标可选或按概率出现。槽位平等——
 * 无 opener / body / tail 之类特权角色，顺序只决定文本左右位置。
 */
export interface GrammarSlot {
  /** 引用的组件类型名。 */
  component: string;
  /** 独立判定是否出现。 */
  optional?: boolean;
  /** 出现概率；数字直用，字符串为 tuning 表达式（如 "slangDensity"），由组装引擎解释（1.2）。 */
  prob?: number | string;
}

/** 语法（句式骨架）：有序引用一批组件类型。可跨池复用。 */
export interface Grammar {
  slots: GrammarSlot[];
}

/** 语法库：语法名 → 语法。可跨池复用。 */
export type GrammarRegistry = Record<string, Grammar>;

/** 池引用的一套语法及其抽选权重。 */
export interface PoolGrammarRef {
  /** 语法名（指向语法库）。 */
  ref: string;
  /** 加权抽选权重，缺省 1。 */
  weight?: number;
}

/**
 * 池维度：键为维度名、值为取值。约定键 形态（POOL_DIM_SHAPE）/ 篇幅（POOL_DIM_LENGTH），
 * 其余世界自定义（作品 / 领域 / 模式 等）。
 */
export type PoolDimensions = Record<string, string>;

/** 池：由维度定义，声明用哪几套语法及权重。 */
export interface Pool {
  id: string;
  dimensions: PoolDimensions;
  grammars: PoolGrammarRef[];
  /**
   * 准用门槛：哪几类账号（tier）可从本池取内容，由作者显式列举。
   * **缺省 / 空数组 = 谁都不能用**（必须勾选才生效，绝不靠规则推断池子归属）。
   * 与 poolAffinities 两层分工：本字段是粗粒度"准不准用"开关；poolAffinities 是准用池内的
   * 偏好权重——同类两个号准用同一批池，靠各自权重表（如对家池权重 0）决定实际只发哪个。
   */
  tiers?: string[];
  /**
   * 池级片段覆盖（混合式）：组件类型名 → 仅本池生效的候选片段。
   * 组装某槽取片段时：本池写了该组件 → 用本池的；没写 → 退回共享组件库。
   * 使通用片段（黑话/情绪词）在组件库写一次跨池复用，同时各池可就地定制自己的槽位内容，
   * 无需为每种语境另造一个组件类型。
   */
  fragments?: ComponentRegistry;
}

/** 加载并合并三类来源（全局原子 + 世界场景 + 临时话题）后的内容池总集。 */
export interface LoadedPools {
  /** 组件类型库（全局 + 世界级合并）。 */
  components: ComponentRegistry;
  /** 语法库（全局 + 世界级合并）。 */
  grammars: GrammarRegistry;
  /** 池列表（全局原子池 + 世界场景池 + 话题池合并，按 id 去重，后来源覆盖先来源）。 */
  pools: Pool[];
}
