import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { logger } from '../logger.js';

/**
 * Tuning 配置服务（最小子集，M5-X.0 的 1.0 步）。
 *
 * 配置范式（见 docs/m5-x-phase1-baseline.md）：模拟器用 dataDir **直读**世界文件夹的配置文件，
 * 社交站 server 不经手。全局默认 `data/global-config/defaults.json`（入 git）与世界级 override
 * `data/worlds/<id>/tuning.json` deep-merge，未覆盖项用默认。
 *
 * 本步只提供 `load(worldId)` + `get(path)`；完整 Tuning 层（evalDerive / reload / onChange /
 * 编辑器面板）留至状态机阶段。所有可调值经此读取，不在 .ts 写死字面量。
 */
export class TuningService {
  private merged: Record<string, unknown> = {};
  private loadedWorldId: string | null = null;
  private hasOverride = false;

  constructor(private dataDir: string) {}

  /** 按活动世界加载并合并配置（切世界时调用）。同世界重复调用会重新读盘（拾取外部编辑）。 */
  load(worldId: string): void {
    const defaults = this.readJson(path.join(this.dataDir, 'global-config', 'defaults.json'));
    if (!defaults) {
      logger.warn('Tuning: global defaults 缺失或不可解析，使用空配置（取值将回退到调用方默认）');
    }
    const overridePath = path.join(this.dataDir, 'worlds', worldId, 'tuning.json');
    const override = this.readJson(overridePath);
    this.hasOverride = override !== null;
    this.merged = deepMerge(defaults ?? {}, override ?? {});
    this.loadedWorldId = worldId;
    logger.info(`Tuning loaded for world ${worldId} (世界 override: ${this.hasOverride ? '有' : '无'})`);
  }

  /**
   * 按点路径取值，如 `get('pools.noveltyPenalty')` / `get('pools.alignmentMatchWeight.match')`。
   * 缺失返回 undefined，由调用方决定默认——调用方不得在 .ts 写死业务可调字面量。
   */
  get<T = unknown>(dotPath: string): T | undefined {
    let cur: unknown = this.merged;
    for (const seg of dotPath.split('.')) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[seg];
    }
    return cur as T | undefined;
  }

  /** 当前已加载的世界 id（未加载为 null）。 */
  get worldId(): string | null {
    return this.loadedWorldId;
  }

  private readJson(filePath: string): Record<string, unknown> | null {
    if (!existsSync(filePath)) return null;
    try {
      const raw = readFileSync(filePath, 'utf-8').replace(/^﻿/, '');
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch (err) {
      logger.error(`Tuning: 读取/解析失败 ${filePath}:`, err);
      return null;
    }
  }
}

/** 递归 deep-merge：对象逐键合并，数组与基本类型由 override 整体覆盖。 */
function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, ov] of Object.entries(override)) {
    const bv = out[k];
    if (isPlainObject(bv) && isPlainObject(ov)) {
      out[k] = deepMerge(bv, ov);
    } else {
      out[k] = ov;
    }
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
