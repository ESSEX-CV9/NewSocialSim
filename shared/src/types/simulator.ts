/**
 * 模拟器运行状态：模拟器周期性上报心跳，服务端按心跳新鲜度判定 running，编辑器控制台展示。
 * 属轻量观测/基础设施状态，时间用现实时间（进程是否在世），与世界模拟时间无关。
 */
export interface SimulatorHeartbeat {
  /** 当前绑定的活动世界 id；未绑定为 null。 */
  boundWorldId: string | null;
  /** 被驱动账号数。 */
  accountCount: number;
  tickNumber: number;
  /** 上次 flush 掉的世界 id（切世界时记）。 */
  lastFlushedWorldId: string | null;
  /** 上次 flush 的现实时间（unix 毫秒）。 */
  lastFlushAt: number | null;
}

export interface SimulatorStatus extends SimulatorHeartbeat {
  /** 由服务端按心跳新鲜度判定（超时未上报即视为未运行）。 */
  running: boolean;
  /** 上次心跳的现实时间；从未上报为 null。 */
  reportedAt: number | null;
}
