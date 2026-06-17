import type { LoadedPools, Pool } from '@socialsim/shared';
import type { System, Entity, TickContext } from '../ecs/types.js';
import type { ApiClient } from '../api-client.js';
import type { TraceSink } from '../trace/trace-sink.js';
import type { TuningService } from '../tuning/tuning-service.js';
import { assembleDetailed, poolsForShape, seededRng, weightedPick } from '../content-pool/assembler.js';
import { logger } from '../logger.js';

/**
 * 顶层发帖系统（确定性，零 LLM）。账号到点按概率从内容池**组装**一条 standalone 帖发出。
 *
 * 1.4：内容来源从扁平 string[] 整体换成 ECS 内容池——按 NPC 的 factions / poolAffinities 在
 * standalone 池里选池 → 组装引擎产文 → 发帖 → 吐含 poolId / 语法 / 所选模块的轨迹。
 * 内容池由模拟器直读世界文件夹加载（见 docs/m5-x-phase1-baseline.md），不再经 server API 取。
 * 取不到内容则跳过本次发帖、不崩（降级保留）。
 */
export class PostingSystem implements System {
  name = 'PostingSystem';

  constructor(
    private api: ApiClient,
    private pools: LoadedPools,
    private tuning: TuningService,
    private trace: TraceSink,
  ) {}

  async update(entities: Entity[], ctx: TickContext): Promise<void> {
    for (const entity of entities) {
      if (!entity.auth) continue;
      if (!this.shouldAct(entity, ctx)) continue;
      if (Math.random() < entity.behavior.postProbability) {
        await this.post(entity, ctx);
      }
    }
  }

  private shouldAct(entity: Entity, ctx: TickContext): boolean {
    if (ctx.simTime < entity.schedule.nextActionAt) return false;

    const { activeHoursStart, activeHoursEnd } = entity.schedule;
    if (activeHoursStart === 0 && activeHoursEnd === 24) return true;

    const hour = new Date(ctx.simTime).getHours();
    if (activeHoursStart <= activeHoursEnd) {
      if (hour < activeHoursStart || hour >= activeHoursEnd) return false;
    } else {
      if (hour < activeHoursStart && hour >= activeHoursEnd) return false;
    }
    return true;
  }

  private async post(entity: Entity, ctx: TickContext): Promise<void> {
    // 每帖一个种子化 RNG：同一（账号, tick）可复现，跨账号/tick 有变化。
    const rng = seededRng((hashStr(entity.profile.handle) ^ (ctx.tickNumber * 0x9e3779b1)) >>> 0);

    const pool = this.selectPool(entity, rng);
    if (!pool) {
      this.scheduleNext(entity, ctx);
      return;
    }

    const result = assembleDetailed(pool, {
      pools: this.pools,
      rng,
      exprVarDefault: this.tuning.get<number>('pools.exprVarDefault'),
      optionalProb: this.tuning.get<number>('pools.optionalProb'),
      vars: {},
    });
    if (!result) {
      this.scheduleNext(entity, ctx);
      return;
    }

    try {
      const posted = await this.api.createPost(entity.auth!.token, result.text);
      logger.info(`[${entity.profile.handle}] posted: "${result.text.slice(0, 40)}" (id ${posted.id}, pool ${pool.id})`);
      this.trace.emit({
        at: Date.now(),
        simTime: ctx.simTime,
        entity: entity.profile.handle,
        action: 'post',
        shape: 'standalone',
        activityState: null,
        intent: 'earnest',
        poolId: pool.id,
        entryId: `${result.grammar}｜${result.fragments.join('+')}`,
        mediaAttached: false,
        targetPostId: null,
        postId: posted.id,
      });
    } catch (err) {
      logger.error(`[${entity.profile.handle}] post failed:`, err);
    }
    this.scheduleNext(entity, ctx);
  }

  /** 在 standalone 池里按 poolAffinities 加权选一个池；无亲和数据时各池走中性默认权重（≈均匀）。 */
  private selectPool(entity: Entity, rng: () => number): Pool | null {
    const candidates = poolsForShape(this.pools.pools, 'standalone');
    if (!candidates.length) return null;
    const aff = entity.profile.poolAffinities;
    const fallback = this.tuning.get<number>('pools.defaultAffinity') ?? 0.3;
    return weightedPick(candidates, (p) => this.affinityWeight(p, aff, fallback), rng);
  }

  /** 池的亲和权重：取 poolAffinities 对该池 id 与各维度值的最大命中；无命中/无亲和表用中性默认。 */
  private affinityWeight(pool: Pool, aff: Record<string, number> | undefined, fallback: number): number {
    if (!aff) return 1;
    let best: number | undefined = aff[pool.id];
    for (const v of Object.values(pool.dimensions)) {
      const a = aff[v];
      if (a !== undefined && (best === undefined || a > best)) best = a;
    }
    return best ?? fallback;
  }

  private scheduleNext(entity: Entity, ctx: TickContext): void {
    const jitter = 0.5 + Math.random();
    const intervalMs = entity.behavior.actionIntervalMinutes * 60_000 * jitter;
    entity.schedule.nextActionAt = ctx.simTime + intervalMs;
  }
}

/** 稳定字符串哈希（FNV-1a 变体），用于派生种子。 */
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
