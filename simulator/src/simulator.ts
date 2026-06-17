import http from 'node:http';
import { watch, existsSync, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { ApiClient } from './api-client.js';
import { EntityRegistry } from './ecs/entity-registry.js';
import { PostingSystem } from './systems/posting-system.js';
import { InteractionSystem } from './systems/interaction-system.js';
import { CascadeSystem } from './systems/cascade-system.js';
import { TraceSink } from './trace/trace-sink.js';
import { TuningService } from './tuning/tuning-service.js';
import { loadPools } from './content-pool/pool-loader.js';
import { startControlServer } from './control/control-server.js';
import type { LoadedPools } from '@socialsim/shared';
import type { System, Entity, TickContext, SimulatorConfig, DrivenAccount } from './ecs/types.js';
import type { SimulatorHeartbeat } from '@socialsim/shared';
import { logger } from './logger.js';

/** 内容池子目录名：fs watch 只关心这些目录下的 .json 改动（避开 world.db-wal 等高频写）。 */
const POOL_DIRS = ['components', 'grammars', 'pools', 'scene-pools', 'topic-pools'];

/** 级联回复用的兜底短语料（Phase 3 由 reply 形态的内容池接管）。 */
const REPLY_POOL = [
  '确实', '有道理', '笑死', '同意', '不太认同', '哈哈哈',
  '学到了', '太真实了', '蹲一个后续', 'mark', '+1', '离谱',
];

interface WorldClock {
  anchorSimMs: number;
  anchorRealMs: number;
  scale: number;
  paused: boolean;
}

interface WorldSession {
  worldId: string;
  registry: EntityRegistry;
  systems: System[];
}

/**
 * 模拟器编排器：不持有任何特定世界数据，跟随服务端当前活动世界运转。
 * 每个 tick：查活动世界 → 世界变了则 flush 旧、登录新世界 npc、重建系统 → 在世界模拟时间下驱动账号。
 */
export class Simulator {
  private api: ApiClient;
  private traceSink: TraceSink;
  private tuning: TuningService;
  private loadedPools: LoadedPools | null = null;
  private session: WorldSession | null = null;
  private clock: WorldClock | null = null;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tickNumber = 0;
  private lastFlushedWorldId: string | null = null;
  private lastFlushAt: number | null = null;
  private controlServer: http.Server | null = null;
  private poolWatchers: FSWatcher[] = [];
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private config: SimulatorConfig) {
    this.api = new ApiClient({ baseUrl: config.apiBaseUrl });
    this.traceSink = new TraceSink(config.dataDir, config.traceSinkUrl);
    this.tuning = new TuningService(config.dataDir);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info(`Simulator starting (API ${this.config.apiBaseUrl}, tick ${this.config.tickIntervalMs}ms) — following active world`);
    // 本地控制接口：供编辑器后端代理预览等请求（见 control-server.ts）。
    this.controlServer = startControlServer(this.config.controlPort, {
      boundWorldId: () => this.session?.worldId ?? null,
      getPools: () => this.loadedPools,
      exprVarDefault: () => this.tuning.get<number>('pools.exprVarDefault') ?? 0.5,
      optionalProb: () => this.tuning.get<number>('pools.optionalProb') ?? 0.5,
    });
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.unwatchPools();
    if (this.controlServer) {
      this.controlServer.close();
      this.controlServer = null;
    }
    if (this.session) this.flush(this.session);
    this.traceSink.close();
  }

  private scheduleNext(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => void this.loop(), this.config.tickIntervalMs);
  }

  /** 世界模拟时间：以最近一次活动世界轮询为锚点，按流速本地推算；暂停则冻结。 */
  private simNow(): number {
    if (!this.clock) return Date.now();
    if (this.clock.paused) return this.clock.anchorSimMs;
    return this.clock.anchorSimMs + (Date.now() - this.clock.anchorRealMs) * this.clock.scale;
  }

  private async loop(): Promise<void> {
    if (!this.running) return;
    try {
      const active = await this.api.getActiveWorld();
      if (!active) {
        logger.warn('No active world (server down?), will retry');
        return;
      }

      this.clock = {
        anchorSimMs: active.meta.clock.simTimeMs,
        anchorRealMs: Date.now(),
        scale: active.meta.clock.scale,
        paused: active.meta.clock.paused,
      };

      if (!this.session || this.session.worldId !== active.meta.id) {
        await this.switchWorld(active.meta.id);
      }

      if (this.session && this.session.registry.count() > 0 && !this.clock.paused) {
        this.tickNumber++;
        const ctx: TickContext = {
          simTime: this.simNow(),
          tickNumber: this.tickNumber,
          deltaMs: this.config.tickIntervalMs,
        };
        const entities = this.session.registry.getAll();
        for (const system of this.session.systems) {
          try {
            await system.update(entities, ctx);
          } catch (err) {
            logger.error(`System ${system.name} error:`, err);
          }
        }
      }
    } catch (err) {
      logger.error('Loop error:', err);
    } finally {
      this.reportStatus();
      this.scheduleNext();
    }
  }

  /** 每 loop 上报一次心跳；服务端按新鲜度判 running，编辑器控制台展示。 */
  private reportStatus(): void {
    const hb: SimulatorHeartbeat = {
      boundWorldId: this.session?.worldId ?? null,
      accountCount: this.session?.registry.count() ?? 0,
      tickNumber: this.tickNumber,
      lastFlushedWorldId: this.lastFlushedWorldId,
      lastFlushAt: this.lastFlushAt,
    };
    void this.api.reportSimulatorStatus(hb);
  }

  /** 切到新活动世界：flush 旧世界、加载新世界被驱动账号（= 有 npc 档案者）、重建系统。 */
  private async switchWorld(worldId: string): Promise<void> {
    if (this.session) {
      logger.info(`Active world changed ${this.session.worldId} -> ${worldId}; flushing old world`);
      this.flush(this.session);
      this.session = null;
    } else {
      logger.info(`Binding to active world ${worldId}`);
    }

    this.traceSink.setWorld(worldId);
    // 直读世界文件夹的配置：全局 defaults + 世界级 tuning.json override（见 docs/m5-x-phase1-baseline.md）。
    this.tuning.load(worldId);
    // 直读并合并三类内容池来源（全局原子 + 世界场景 + 话题），供 PostingSystem 组装发帖。
    const pools = loadPools(this.config.dataDir, worldId);
    this.loadedPools = pools;
    logger.info(
      `Content pools loaded for world ${worldId}: ` +
        `${Object.keys(pools.components).length} 组件类型 / ` +
        `${Object.keys(pools.grammars).length} 语法 / ${pools.pools.length} 池`,
    );
    // 监视世界的池子文件，编辑器改完保存即热重载，下次发帖用新定义、不重启。
    this.watchPools(worldId);

    const registry = new EntityRegistry();
    let profiles: Awaited<ReturnType<ApiClient['getNpcProfiles']>>['profiles'] = [];
    try {
      profiles = (await this.api.getNpcProfiles(this.config.adminToken)).profiles;
    } catch (err) {
      logger.error('Failed to load npc-profiles:', err);
    }

    for (const p of profiles) {
      try {
        const login = await this.api.adminLoginAs(this.config.adminToken, p.userId);
        const account: DrivenAccount = {
          userId: String(p.userId),
          handle: p.handle,
          displayName: login.displayName,
          tier: p.tier,
          interests: p.interests ?? [],
          activeHoursStart: p.activeHoursStart,
          activeHoursEnd: p.activeHoursEnd,
          postProbability: p.postProbability,
          likeProbability: p.likeProbability,
          repostProbability: p.repostProbability,
          replyProbability: p.replyProbability,
          actionIntervalMinutes: p.actionIntervalMinutes,
          ...(p.factions !== undefined ? { factions: p.factions } : {}),
          ...(p.poolAffinities !== undefined ? { poolAffinities: p.poolAffinities } : {}),
          ...(p.personality !== undefined ? { personality: p.personality } : {}),
          ...(p.stance !== undefined ? { stance: p.stance } : {}),
          ...(p.writingStyle !== undefined ? { writingStyle: p.writingStyle } : {}),
        };
        const entity = registry.register(account);
        entity.auth = { token: login.token, expiresAt: Date.now() + 30 * 24 * 3600_000 };
        logger.info(`Driving @${p.handle} (id ${p.userId}, ${p.tier})`);
      } catch (err) {
        logger.error(`Failed to bind @${p.handle} (id ${p.userId}):`, err);
      }
    }

    const entityMap = new Map<string, Entity>(registry.getAll().map(e => [e.id, e]));
    const systems: System[] = [
      // 传内容池提供者（取最新）而非固定快照，支持热重载后立即生效。
      new PostingSystem(this.api, () => this.loadedPools!, this.tuning, this.traceSink),
      new InteractionSystem(this.api, this.traceSink),
      new CascadeSystem(this.api, entityMap, [...REPLY_POOL], this.traceSink),
    ];

    this.session = { worldId, registry, systems };
    logger.info(`World ${worldId} ready: ${registry.count()} driven account(s)`);
  }

  /** flush 旧世界运行时状态。Step 0 暂无运行时态（mood/memory 等在后续里程碑加），占位日志。 */
  private flush(session: WorldSession): void {
    logger.info(`Flushed world ${session.worldId} (no runtime state in Step 0)`);
    this.lastFlushedWorldId = session.worldId;
    this.lastFlushAt = Date.now();
  }

  /** 监视世界与全局的池子文件目录；改动经防抖后热重载内容池（编辑器存盘即生效）。 */
  private watchPools(worldId: string): void {
    this.unwatchPools();
    const dirs = [
      path.join(this.config.dataDir, 'global-pools'),
      path.join(this.config.dataDir, 'worlds', worldId),
    ];
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      try {
        const w = watch(dir, { recursive: true }, (_event, filename) => {
          if (!filename) return;
          const f = filename.toString().replace(/\\/g, '/');
          if (!f.endsWith('.json')) return;
          if (!POOL_DIRS.includes(f.split('/')[0]!)) return; // 只关心池子相关子目录，避开 world.db-wal 等
          this.scheduleReload();
        });
        this.poolWatchers.push(w);
      } catch (err) {
        logger.warn(`监视池子目录失败 ${dir}:`, err);
      }
    }
  }

  private unwatchPools(): void {
    for (const w of this.poolWatchers) {
      try { w.close(); } catch { /* 已关则忽略 */ }
    }
    this.poolWatchers = [];
    if (this.reloadTimer) { clearTimeout(this.reloadTimer); this.reloadTimer = null; }
  }

  /** 防抖：文件多次写入合并为一次重载。 */
  private scheduleReload(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      this.reloadPools();
    }, 300);
  }

  private reloadPools(): void {
    if (!this.session) return;
    try {
      this.loadedPools = loadPools(this.config.dataDir, this.session.worldId);
      logger.info(`Content pools hot-reloaded for world ${this.session.worldId}: ${this.loadedPools.pools.length} 池`);
    } catch (err) {
      logger.error('内容池热重载失败:', err);
    }
  }
}
