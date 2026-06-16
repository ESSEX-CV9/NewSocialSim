import path from 'node:path';
import Database from 'better-sqlite3';
import type { StoredSimTraceEvent, SimTraceShape, SimTraceAction } from '@socialsim/shared';

/**
 * 决策轨迹只读器：编辑器后端按活动世界开 sim-trace.db 的只读连接，按 sim_time 区间查询。
 * 分库原则：sim-trace.db 模拟器独占写、编辑器后端只读（WAL 下可与模拟器并发）。
 * 连接按 worldId 缓存，切世界时关旧开新；世界从未跑过模拟器（库文件不存在）时返回空集，不报错。
 */

/** trace_event 表的原始行形态（snake_case，与建表一致）。 */
interface TraceRow {
  id: number;
  at: number;
  sim_time: number;
  entity: string;
  action: string;
  activity_state: string | null;
  intent: string | null;
  shape: string | null;
  pool_id: string | null;
  entry_id: string | null;
  media_attached: number;
  media_reason: string | null;
  target_post_id: string | null;
}

export interface TraceQuery {
  /** sim_time 下界（含），缺省 0。 */
  from?: number | undefined;
  /** sim_time 上界（含），缺省无上界。 */
  to?: number | undefined;
  /** 只取某账号 handle 的轨迹。 */
  entity?: string | undefined;
  /** 返回条数上限（防一次拉爆），缺省 2000、硬上限 10000。 */
  limit?: number | undefined;
}

const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 10000;

export class TraceReader {
  private db: Database.Database | null = null;
  private worldId: string | null = null;

  constructor(private dataDir: string) {}

  /** 切到某世界的轨迹库（只读）；库不存在返回 false，调用方据此返回空集。 */
  private bind(worldId: string): boolean {
    if (this.worldId === worldId && this.db) return true;
    this.close();
    const dbPath = path.join(this.dataDir, 'worlds', worldId, 'sim-trace.db');
    try {
      // fileMustExist：世界没跑过模拟器就没有此库，不在只读侧建表。
      const db = new Database(dbPath, { readonly: true, fileMustExist: true });
      this.db = db;
      this.worldId = worldId;
      return true;
    } catch {
      this.db = null;
      this.worldId = null;
      return false;
    }
  }

  /** 查询某世界某 sim_time 区间的轨迹，升序（sim_time, id）。世界无库时返回空数组。 */
  query(worldId: string, q: TraceQuery): StoredSimTraceEvent[] {
    if (!this.bind(worldId)) return [];
    const from = q.from ?? 0;
    const to = q.to ?? Number.MAX_SAFE_INTEGER;
    const limit = Math.min(Math.max(1, q.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const where = ['sim_time >= @from', 'sim_time <= @to'];
    const params: Record<string, unknown> = { from, to, limit };
    if (q.entity) {
      where.push('entity = @entity');
      params.entity = q.entity;
    }
    try {
      const rows = this.db!
        .prepare(
          `SELECT id, at, sim_time, entity, action, activity_state, intent, shape,
                  pool_id, entry_id, media_attached, media_reason, target_post_id
             FROM trace_event
            WHERE ${where.join(' AND ')}
            ORDER BY sim_time ASC, id ASC
            LIMIT @limit`,
        )
        .all(params) as TraceRow[];
      return rows.map(mapRow);
    } catch {
      // 库结构异常/被占用等，降级为空集，不让查询端点崩。
      return [];
    }
  }

  close(): void {
    if (this.db) {
      try { this.db.close(); } catch { /* ignore */ }
    }
    this.db = null;
    this.worldId = null;
  }
}

function mapRow(r: TraceRow): StoredSimTraceEvent {
  return {
    id: r.id,
    at: r.at,
    simTime: r.sim_time,
    entity: r.entity,
    action: r.action as SimTraceAction,
    activityState: r.activity_state,
    intent: r.intent,
    shape: r.shape as SimTraceShape | null,
    poolId: r.pool_id,
    entryId: r.entry_id,
    mediaAttached: r.media_attached === 1,
    mediaReason: r.media_reason,
    targetPostId: r.target_post_id,
  };
}
