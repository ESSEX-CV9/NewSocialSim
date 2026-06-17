import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  POOL_DIM_SHAPE,
  type ComponentRegistry,
  type Fragment,
  type Grammar,
  type GrammarRegistry,
  type LoadedPools,
  type Pool,
  type PoolDimensions,
  type PoolGrammarRef,
  type PoolShape,
} from '@socialsim/shared';
import { logger } from '../logger.js';

/**
 * 内容池加载器（1.1）：按活动世界直读并合并三类来源，解析为「组件类型库 + 语法库 + 池列表」结构。
 *
 * 配置范式（见 docs/m5-x-phase1-baseline.md）：模拟器用 dataDir 直读文件，social server 不经手。
 * 布局：
 *   全局共享（入 git）   data/global-pools/{components,grammars,pools}/ *.json
 *   世界级               data/worlds/<id>/{components,grammars,scene-pools}/ *.json
 *   话题专属（临时）      data/worlds/<id>/topic-pools/ *.json
 *
 * 合并语义：组件库同名组件**追加片段**（世界扩充全局）；语法库同名**世界覆盖全局**；
 * 池按 id 去重，后来源（世界 / 话题）覆盖先来源（全局）。
 *
 * 本步只加载 + 轻校验（悬空引用告警），不做组装（属 1.2）。
 */

/** 片段在盘上允许裸字符串简写；加载时归一化为 Fragment。 */
type RawFragment = string | Fragment;
type RawComponentFile = Record<string, RawFragment[]>;
type RawGrammarFile = Record<string, Grammar>;
interface RawPoolBody {
  dimensions: PoolDimensions;
  grammars: PoolGrammarRef[];
  /** 准用门槛：哪几类账号（tier）可用本池；缺省/空 = 谁都不能用（见 Pool.tiers）。 */
  tiers?: string[];
  /** 池级片段覆盖（混合式）：组件名 → 仅本池生效的候选片段（允许字符串简写）。 */
  fragments?: Record<string, RawFragment[]>;
}
type RawPoolFile = Record<string, RawPoolBody>;

export function loadPools(dataDir: string, worldId: string): LoadedPools {
  const globalDir = path.join(dataDir, 'global-pools');
  const worldDir = path.join(dataDir, 'worlds', worldId);

  // 组件库：全局在前、世界追加（同名组件 concat 片段）。
  const components: ComponentRegistry = {};
  mergeComponents(components, readComponentDir(path.join(globalDir, 'components')));
  mergeComponents(components, readComponentDir(path.join(worldDir, 'components')));

  // 语法库：全局在前、世界覆盖（同名 grammar 整体替换）。
  const grammars: GrammarRegistry = {};
  Object.assign(grammars, readGrammarDir(path.join(globalDir, 'grammars')));
  Object.assign(grammars, readGrammarDir(path.join(worldDir, 'grammars')));

  // 池：全局原子 → 世界场景 → 话题，按 id 去重（后覆盖先）。
  const poolMap = new Map<string, Pool>();
  for (const dir of [
    path.join(globalDir, 'pools'),
    path.join(worldDir, 'scene-pools'),
    path.join(worldDir, 'topic-pools'),
  ]) {
    for (const [id, body] of readPoolDir(dir)) {
      const pool: Pool = { id, dimensions: body.dimensions, grammars: body.grammars };
      if (Array.isArray(body.tiers)) pool.tiers = body.tiers;
      if (body.fragments) {
        const overrides: ComponentRegistry = {};
        for (const [name, frags] of Object.entries(body.fragments)) {
          if (Array.isArray(frags)) overrides[name] = frags.map(normalizeFragment);
        }
        pool.fragments = overrides;
      }
      poolMap.set(id, pool);
    }
  }
  const pools = [...poolMap.values()];

  validate({ components, grammars, pools });
  return { components, grammars, pools };
}

/** 列目录下所有 .json 并逐个解析（BOM 容忍，单文件失败降级告警不中断）。 */
function readJsonFilesInDir<T>(dir: string): T[] {
  if (!existsSync(dir)) return [];
  const out: T[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.toLowerCase().endsWith('.json')) continue;
    const filePath = path.join(dir, name);
    try {
      const raw = readFileSync(filePath, 'utf-8').replace(/^﻿/, '');
      out.push(JSON.parse(raw) as T);
    } catch (err) {
      logger.error(`内容池：读取/解析失败 ${filePath}:`, err);
    }
  }
  return out;
}

function readComponentDir(dir: string): ComponentRegistry {
  const merged: ComponentRegistry = {};
  for (const file of readJsonFilesInDir<RawComponentFile>(dir)) {
    for (const [name, frags] of Object.entries(file)) {
      if (!Array.isArray(frags)) continue;
      (merged[name] ??= []).push(...frags.map(normalizeFragment));
    }
  }
  return merged;
}

function readGrammarDir(dir: string): GrammarRegistry {
  const merged: GrammarRegistry = {};
  for (const file of readJsonFilesInDir<RawGrammarFile>(dir)) {
    for (const [name, grammar] of Object.entries(file)) {
      if (grammar && Array.isArray(grammar.slots)) merged[name] = grammar;
    }
  }
  return merged;
}

function readPoolDir(dir: string): Array<[string, RawPoolBody]> {
  const out: Array<[string, RawPoolBody]> = [];
  for (const file of readJsonFilesInDir<RawPoolFile>(dir)) {
    for (const [id, body] of Object.entries(file)) {
      if (body && typeof body === 'object' && body.dimensions && Array.isArray(body.grammars)) out.push([id, body]);
    }
  }
  return out;
}

function normalizeFragment(raw: RawFragment): Fragment {
  return typeof raw === 'string' ? { text: raw } : raw;
}

function mergeComponents(into: ComponentRegistry, add: ComponentRegistry): void {
  for (const [name, frags] of Object.entries(add)) (into[name] ??= []).push(...frags);
}

/** 轻校验：池引用的语法、语法槽引用的组件类型是否存在；悬空引用告警（不抛，组装阶段会跳过）。 */
function validate(loaded: LoadedPools): void {
  const missingGrammars = new Set<string>();
  const missingComponents = new Set<string>();
  const badShape = new Set<string>();
  const noTiers = new Set<string>();
  const SHAPES: readonly PoolShape[] = ['standalone', 'reply', 'quote'];
  for (const pool of loaded.pools) {
    if (!SHAPES.includes(pool.dimensions[POOL_DIM_SHAPE] as PoolShape)) badShape.add(pool.id);
    if (!pool.tiers?.length) noTiers.add(pool.id);
    for (const g of pool.grammars) {
      const grammar = loaded.grammars[g.ref];
      if (!grammar) {
        missingGrammars.add(`${pool.id} → ${g.ref}`);
        continue;
      }
      for (const slot of grammar.slots) {
        if (!loaded.components[slot.component]) missingComponents.add(`${g.ref} → ${slot.component}`);
      }
    }
  }
  if (missingGrammars.size) logger.warn(`内容池：悬空语法引用 ${[...missingGrammars].join(', ')}`);
  if (missingComponents.size) logger.warn(`内容池：悬空组件引用 ${[...missingComponents].join(', ')}`);
  if (badShape.size) logger.warn(`内容池：池缺少/非法 形态 维度（不可被任何动作选中）：${[...badShape].join(', ')}`);
  if (noTiers.size) logger.warn(`内容池：池未勾选准用账号类型（tiers 缺省/空 = 谁都不能用，不会被选中）：${[...noTiers].join(', ')}`);
}
