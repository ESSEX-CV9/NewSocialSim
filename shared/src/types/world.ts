/** 世界时钟的持久化状态（存于 world.json，加载时恢复为运行中的 SimClock） */
export interface ClockState {
  /** 保存那一刻的模拟时间（unix 毫秒形式） */
  simTimeMs: number;
  /** 流速：1 = 与现实同速，60 = 现实 1 秒过模拟 1 分钟，0 不合法（用 paused 表达暂停） */
  scale: number;
  paused: boolean;
}

/** 仅用于展示的历法配置，如修真世界的"天元历" */
export interface CalendarConfig {
  /** 历法名称，如 "公历" / "天元历" */
  label: string;
}

/** 一个世界的元数据，对应 data/worlds/<id>/world.json */
export interface WorldMeta {
  id: string;
  name: string;
  description: string;
  /** 该世界默认界面语言 */
  locale: 'zh-CN' | 'en';
  clock: ClockState;
  calendar: CalendarConfig;
  /** 创建时的真实时间（unix 毫秒），仅作管理信息，与模拟时间无关 */
  createdAtRealMs: number;
}

/** 世界列表项（含是否为当前活动世界） */
export interface WorldSummary {
  id: string;
  name: string;
  description: string;
  locale: WorldMeta['locale'];
  active: boolean;
}

/** GET /api/admin/worlds/active 的响应 */
export interface ActiveWorldInfo {
  meta: WorldMeta;
  /** 此刻的模拟时间（unix 毫秒形式） */
  simTimeMs: number;
}
