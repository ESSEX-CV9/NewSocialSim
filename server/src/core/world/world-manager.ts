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

export interface SnapshotInfo {
  name: string;
  description: string;
  createdAtRealMs: number;
}

export interface CreateWorldInput {
  id: string;
  name: string;
  description?: string;
  locale?: WorldMeta['locale'];
  /** 模拟时间起点与流速，默认：从现实当前时刻开始、1 倍速 */
  clock?: Partial<ClockState>;
  calendar?: { label: string };
  contentRating?: WorldMeta['contentRating'];
}

interface ServerState {
  activeWorldId: string | null;
}

/** 容忍 Windows 编辑器写入的 UTF-8 BOM */
function readJsonFile(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
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
  private readonly activatedListeners: Array<() => void> = [];

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
      contentRating: input.contentRating ?? 'safe',
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
    for (const cb of this.activatedListeners) cb();
    return this.context;
  }

  /** 热切换成功（新上下文已就绪）后的回调；切到同一世界的空操作不触发 */
  onActivated(cb: () => void): void {
    this.activatedListeners.push(cb);
  }

  /** 把当前世界的时钟快照写回 world.json */
  persistClock(): void {
    if (!this.context) return;
    this.context.meta.clock = this.context.clock.snapshot();
    this.writeMeta(this.context.meta);
  }

  /** 更新世界元数据（不含时钟，时钟用 clockControl） */
  updateMeta(worldId: string, patch: {
    name?: string;
    description?: string;
    locale?: WorldMeta['locale'];
    contentRating?: WorldMeta['contentRating'];
    calendar?: { label: string };
  }): WorldMeta {
    if (!this.exists(worldId)) throw new NotFoundError(`世界 "${worldId}" 不存在`);
    const meta = this.readMeta(worldId);
    if (patch.name !== undefined) meta.name = patch.name;
    if (patch.description !== undefined) meta.description = patch.description;
    if (patch.locale !== undefined) meta.locale = patch.locale;
    if (patch.contentRating !== undefined) meta.contentRating = patch.contentRating;
    if (patch.calendar !== undefined) meta.calendar = patch.calendar;
    this.writeMeta(meta);
    if (this.context?.worldId === worldId) this.context.meta = meta;
    return meta;
  }

  /** 时钟控制：暂停/恢复/调速/跳转，仅对当前活动世界生效 */
  clockControl(action: { type: 'pause' } | { type: 'resume' } | { type: 'setScale'; scale: number } | { type: 'setTime'; simTimeMs: number }): ClockState {
    const ctx = this.current();
    switch (action.type) {
      case 'pause': ctx.clock.pause(); break;
      case 'resume': ctx.clock.resume(); break;
      case 'setScale': ctx.clock.setScale(action.scale); break;
      case 'setTime': ctx.clock.setTime(action.simTimeMs); break;
    }
    this.persistClock();
    return ctx.clock.snapshot();
  }

  /** 复制世界为独立平行宇宙（含 media 完整拷贝） */
  copyWorld(sourceId: string, newId: string): WorldMeta {
    if (!WORLD_ID_PATTERN.test(newId)) {
      throw new ValidationError(`世界 id 格式不合法：${newId}`);
    }
    if (!this.exists(sourceId)) throw new NotFoundError(`世界 "${sourceId}" 不存在`);
    if (this.exists(newId)) throw new ConflictError(`世界 "${newId}" 已存在`);

    if (this.context?.worldId === sourceId) this.persistClock();

    const src = this.worldDir(sourceId);
    const dst = this.worldDir(newId);
    fs.cpSync(src, dst, { recursive: true });

    const meta = this.readMeta(newId);
    meta.id = newId;
    meta.name = `${meta.name} (copy)`;
    meta.createdAtRealMs = Date.now();
    this.writeMeta(meta);
    return meta;
  }

  /** 创建快照：只备份 db + json，不复制 media（media 只增不减，所有快照共享） */
  createSnapshot(name: string, description?: string): SnapshotInfo {
    if (!/^[a-z0-9][a-z0-9_-]{0,49}$/.test(name)) {
      throw new ValidationError('快照名只能由小写字母、数字、连字符、下划线组成（1-50 字符）');
    }
    const ctx = this.current();
    this.persistClock();

    const snapshotsDir = path.join(this.worldDir(ctx.worldId), 'snapshots', name);
    if (fs.existsSync(snapshotsDir)) throw new ConflictError(`快照 "${name}" 已存在`);
    fs.mkdirSync(snapshotsDir, { recursive: true });

    ctx.db.backup(path.join(snapshotsDir, 'world.db'));
    fs.copyFileSync(
      path.join(this.worldDir(ctx.worldId), 'world.json'),
      path.join(snapshotsDir, 'world.json'),
    );

    const info: SnapshotInfo = { name, description: description ?? '', createdAtRealMs: Date.now() };
    fs.writeFileSync(path.join(snapshotsDir, '_snapshot.json'), JSON.stringify(info, null, 2), 'utf8');
    return info;
  }

  listSnapshots(worldId: string): SnapshotInfo[] {
    const snapshotsRoot = path.join(this.worldDir(worldId), 'snapshots');
    if (!fs.existsSync(snapshotsRoot)) return [];
    const entries = fs.readdirSync(snapshotsRoot, { withFileTypes: true });
    const result: SnapshotInfo[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const metaFile = path.join(snapshotsRoot, e.name, '_snapshot.json');
      if (!fs.existsSync(metaFile)) continue;
      result.push(readJsonFile(metaFile) as SnapshotInfo);
    }
    return result.sort((a, b) => b.createdAtRealMs - a.createdAtRealMs);
  }

  /** 回滚到快照：关连接 → 覆盖 db + json → 重建 context */
  restoreSnapshot(name: string): void {
    const ctx = this.current();
    const snapshotDir = path.join(this.worldDir(ctx.worldId), 'snapshots', name);
    if (!fs.existsSync(path.join(snapshotDir, '_snapshot.json'))) {
      throw new NotFoundError(`快照 "${name}" 不存在`);
    }

    const worldDir = this.worldDir(ctx.worldId);
    ctx.db.close();

    fs.copyFileSync(path.join(snapshotDir, 'world.db'), path.join(worldDir, 'world.db'));
    fs.copyFileSync(path.join(snapshotDir, 'world.json'), path.join(worldDir, 'world.json'));

    const meta = this.readMeta(ctx.worldId);
    const db = openDb(path.join(worldDir, 'world.db'));
    migrate(db);
    this.context = { worldId: ctx.worldId, db, clock: new SimClock(meta.clock), meta };
    for (const cb of this.activatedListeners) cb();
  }

  removeSnapshot(worldId: string, name: string): void {
    const snapshotDir = path.join(this.worldDir(worldId), 'snapshots', name);
    if (!fs.existsSync(snapshotDir)) throw new NotFoundError(`快照 "${name}" 不存在`);
    fs.rmSync(snapshotDir, { recursive: true, force: true });
  }

  /** 删除非活动世界 */
  deleteWorld(worldId: string): void {
    if (!this.exists(worldId)) throw new NotFoundError(`世界 "${worldId}" 不存在`);
    if (this.context?.worldId === worldId) {
      throw new ConflictError('不能删除当前活动的世界');
    }
    fs.rmSync(this.worldDir(worldId), { recursive: true, force: true });
  }

  /** 获取世界目录路径（供设定文件库等外部模块使用） */
  getWorldDir(worldId: string): string {
    if (!this.exists(worldId)) throw new NotFoundError(`世界 "${worldId}" 不存在`);
    return this.worldDir(worldId);
  }

  private exists(worldId: string): boolean {
    return fs.existsSync(path.join(this.worldDir(worldId), 'world.json'));
  }

  private worldDir(worldId: string): string {
    return path.join(this.worldsDir, worldId);
  }

  private readMeta(worldId: string): WorldMeta {
    const file = path.join(this.worldDir(worldId), 'world.json');
    const meta = readJsonFile(file) as WorldMeta;
    // 旧世界的 world.json 没有此字段，缺省按最保守的 safe
    meta.contentRating ??= 'safe';
    return meta;
  }

  private writeMeta(meta: WorldMeta): void {
    const file = path.join(this.worldDir(meta.id), 'world.json');
    fs.writeFileSync(file, JSON.stringify(meta, null, 2), 'utf8');
  }

  private readServerState(): ServerState {
    if (!fs.existsSync(this.stateFile)) return { activeWorldId: null };
    return readJsonFile(this.stateFile) as ServerState;
  }

  private writeServerState(state: ServerState): void {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2), 'utf8');
  }
}
