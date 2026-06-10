import fs from 'node:fs';
import path from 'node:path';
import type { ClockState, WorldMeta, WorldSummary } from '@socialsim/shared';
import { SimClock } from '../clock/clock.js';
import { openDb, type WorldDb } from '../db/database.js';
import { migrate } from '../db/migrations.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/app-error.js';

/** 当前活动世界的运行时上下文。业务模块每次请求时获取，绝不长期持有。 */
export interface WorldContext {
  worldId: string;
  db: WorldDb;
  clock: SimClock;
  meta: WorldMeta;
}

export interface CreateWorldInput {
  id: string;
  name: string;
  description?: string;
  locale?: WorldMeta['locale'];
  /** 模拟时间起点与流速，默认：从现实当前时刻开始、1 倍速 */
  clock?: Partial<ClockState>;
  calendar?: { label: string };
}

interface ServerState {
  activeWorldId: string | null;
}

const WORLD_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,49}$/;
const CLOCK_PERSIST_INTERVAL_MS = 30_000;

/**
 * 多世界的核心：负责世界的创建/枚举/热切换。
 * 热切换 = 保存旧世界时钟 → 关闭旧连接 → 打开新库并迁移 → 恢复新时钟 → 原子替换上下文。
 */
export class WorldManager {
  private context: WorldContext | null = null;
  private persistTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly worldsDir: string,
    private readonly stateFile: string,
  ) {}

  /** 服务启动时调用：恢复上次的活动世界，并启动时钟落盘定时器 */
  init(): void {
    fs.mkdirSync(this.worldsDir, { recursive: true });
    const last = this.readServerState().activeWorldId;
    if (last && this.exists(last)) {
      this.activate(last);
    }
    // 定期把时钟快照写回 world.json，进程异常退出时最多丢这点间隔的模拟时间
    this.persistTimer = setInterval(() => this.persistClock(), CLOCK_PERSIST_INTERVAL_MS);
    this.persistTimer.unref();
  }

  shutdown(): void {
    if (this.persistTimer) clearInterval(this.persistTimer);
    if (this.context) {
      this.persistClock();
      this.context.db.close();
      this.context = null;
    }
  }

  /** 获取当前世界上下文；未加载任何世界时业务 API 应得到 409 */
  current(): WorldContext {
    if (!this.context) {
      throw new ConflictError('当前没有已加载的世界，请先创建或激活一个世界', 'NO_ACTIVE_WORLD');
    }
    return this.context;
  }

  activeWorldId(): string | null {
    return this.context?.worldId ?? null;
  }

  list(): WorldSummary[] {
    const entries = fs.readdirSync(this.worldsDir, { withFileTypes: true });
    const result: WorldSummary[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const metaFile = path.join(this.worldsDir, e.name, 'world.json');
      if (!fs.existsSync(metaFile)) continue;
      const meta = this.readMeta(e.name);
      result.push({
        id: meta.id,
        name: meta.name,
        description: meta.description,
        locale: meta.locale,
        active: meta.id === this.activeWorldId(),
      });
    }
    return result;
  }

  create(input: CreateWorldInput): WorldMeta {
    if (!WORLD_ID_PATTERN.test(input.id)) {
      throw new ValidationError(
        `世界 id 只能由小写字母、数字、连字符组成（2-50 字符），收到 "${input.id}"`,
      );
    }
    if (this.exists(input.id)) {
      throw new ConflictError(`世界 "${input.id}" 已存在`);
    }

    const meta: WorldMeta = {
      id: input.id,
      name: input.name,
      description: input.description ?? '',
      locale: input.locale ?? 'zh-CN',
      clock: {
        simTimeMs: input.clock?.simTimeMs ?? Date.now(),
        scale: input.clock?.scale ?? 1,
        paused: input.clock?.paused ?? false,
      },
      calendar: input.calendar ?? { label: '公历' },
      createdAtRealMs: Date.now(),
    };
    if (!Number.isFinite(meta.clock.scale) || meta.clock.scale <= 0) {
      throw new ValidationError(`时钟流速必须为正数，收到 ${meta.clock.scale}`);
    }

    const dir = this.worldDir(meta.id);
    fs.mkdirSync(dir, { recursive: true });
    this.writeMeta(meta);
    // 立刻建库跑 migration，保证世界文件夹随时可整体复制为平行宇宙
    const db = openDb(path.join(dir, 'world.db'));
    try {
      migrate(db);
    } finally {
      db.close();
    }
    return meta;
  }

  /** 热切换到指定世界 */
  activate(worldId: string): WorldContext {
    if (this.context?.worldId === worldId) return this.context;
    if (!this.exists(worldId)) {
      throw new NotFoundError(`世界 "${worldId}" 不存在`);
    }

    const meta = this.readMeta(worldId);
    const db = openDb(path.join(this.worldDir(worldId), 'world.db'));
    try {
      migrate(db);
    } catch (err) {
      db.close();
      throw err;
    }

    // 新世界已就绪，此后才动旧上下文，失败不影响当前世界
    if (this.context) {
      this.persistClock();
      this.context.db.close();
    }
    this.context = { worldId, db, clock: new SimClock(meta.clock), meta };
    this.writeServerState({ activeWorldId: worldId });
    return this.context;
  }

  /** 把当前世界的时钟快照写回 world.json */
  persistClock(): void {
    if (!this.context) return;
    this.context.meta.clock = this.context.clock.snapshot();
    this.writeMeta(this.context.meta);
  }

  private exists(worldId: string): boolean {
    return fs.existsSync(path.join(this.worldDir(worldId), 'world.json'));
  }

  private worldDir(worldId: string): string {
    return path.join(this.worldsDir, worldId);
  }

  private readMeta(worldId: string): WorldMeta {
    const file = path.join(this.worldDir(worldId), 'world.json');
    return JSON.parse(fs.readFileSync(file, 'utf8')) as WorldMeta;
  }

  private writeMeta(meta: WorldMeta): void {
    const file = path.join(this.worldDir(meta.id), 'world.json');
    fs.writeFileSync(file, JSON.stringify(meta, null, 2), 'utf8');
  }

  private readServerState(): ServerState {
    if (!fs.existsSync(this.stateFile)) return { activeWorldId: null };
    return JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as ServerState;
  }

  private writeServerState(state: ServerState): void {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2), 'utf8');
  }
}
