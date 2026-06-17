import path from 'node:path';
import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import type { StoredSimTraceEvent, SimTraceShape, SimTraceAction } from '@socialsim/shared';

/**
 * 决策轨迹只读器：编辑器后端按活动世界开 sim-trace.db 的只读连接，按 sim_time 区间查询。
 * 分库原则：sim-trace.db 模拟器独占写、编辑器后端只读（WAL 下可与模拟器并发）。
 *
 * 每次查询开一个全新只读连接、读完即关——绝不缓存连接：WAL 模式下数据多在 -wal 文件，
 * 一条长期缓存的只读连接若在 -shm 共享内存索引未就绪时（如模拟器尚未启动）打开，会退化为
 * "只读主库文件、忽略 WAL"并一直保持该状态，导致读到的几乎为空。每次新开连接可规避此坑。
 * 世界从未跑过模拟器（库文件不存在）时返回空集，不报错。
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
  post_id: string | null;
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
  /** 精确取产出该帖的轨迹（post/reply/quote 块「为什么」增强用，匹配 post_id）。 */
  postId?: string | undefined;
  /** 精确取作用于该帖的轨迹（like/repost 块「为什么」增强用，匹配 target_post_id）。 */
  targetPostId?: string | undefined;
  /** 限定动作类型（如 like/repost，与 targetPostId 联用区分同帖的赞/转）。 */
  action?: string | undefined;
}

const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 10000;

export class TraceReader {
  constructor(private dataDir: string) {}

  /** 查询某世界某 sim_time 区间的轨迹，升序（sim_time, id）。世界无库时返回空数组。 */
  query(worldId: string, q: TraceQuery): StoredSimTraceEvent[] {
    const dbPath = path.join(this.dataDir, 'worlds', worldId, 'sim-trace.db');
    // 世界没跑过模拟器就没有此库，返回空集（正常，不告警）。
    if (!existsSync(dbPath)) return [];
    let db: Database.Database | null = null;
    try {
      // 每次新开只读连接（WAL 坑见类注释）。
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
      const from = q.from ?? 0;
      const to = q.to ?? Number.MAX_SAFE_INTEGER;
      const limit = Math.min(Math.max(1, q.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
      const where = ['sim_time >= @from', 'sim_time <= @to'];
      const params: Record<string, unknown> = { from, to, limit };
      if (q.entity) {
        where.push('entity = @entity');
        params.entity = q.entity;
      }
      if (q.postId) {
        where.push('post_id = @postId');
        params.postId = q.postId;
      }
      if (q.targetPostId) {
        where.push('target_post_id = @targetPostId');
        params.targetPostId = q.targetPostId;
      }
      if (q.action) {
        where.push('action = @action');
        params.action = q.action;
      }
      const rows = db
        .prepare(
          `SELECT id, at, sim_time, entity, action, activity_state, intent, shape,
                  pool_id, entry_id, media_attached, media_reason, target_post_id, post_id
             FROM trace_event
            WHERE ${where.join(' AND ')}
            ORDER BY sim_time ASC, id ASC
            LIMIT @limit`,
        )
        .all(params) as TraceRow[];
      return rows.map(mapRow);
    } catch (err) {
      // 库存在却读失败（结构异常 / 原生模块 ABI 不匹配 / 被占用等）：降级空集不崩，但**打日志**——
      // 曾因静默吞错把 better-sqlite3 ABI 不匹配藏了很久，难排查。
      console.error(`[trace-reader] 读 ${dbPath} 失败:`, err instanceof Error ? err.message : err);
      return [];
    } finally {
      if (db) {
        try { db.close(); } catch { /* ignore */ }
      }
    }
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
    postId: r.post_id,
  };
}
