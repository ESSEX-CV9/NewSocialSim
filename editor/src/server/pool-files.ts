import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type {
  ComponentRegistry,
  Fragment,
  Grammar,
  GrammarSlot,
  PoolDimensions,
  PoolGrammarRef,
} from '@socialsim/shared';

/**
 * 编辑器后端：读/写世界文件夹与全局层的内容池文件（1.6）。
 *
 * 配置直读文件范式：编辑器后端是改内容池配置的唯一写方，模拟器只读 + fs watch 热重载。
 * 文件布局：全局 `data/global-pools/{components,grammars,pools}/`、
 * 世界 `data/worlds/<id>/{components,grammars,scene-pools,topic-pools}/`。
 *
 * 视图带 provenance（scope + file 相对路径），供存回原文件；文件归属对作者透明——
 * 改谁存回其来源文件，新建条目落到合理默认文件（见 defaultFile）。
 */

export type PoolScope = 'global' | 'world';
export type PoolLayer = 'component' | 'grammar' | 'pool';

export interface ComponentEntry {
  name: string;
  fragments: Fragment[];
  scope: PoolScope;
  file: string;
}
export interface GrammarEntry {
  name: string;
  slots: GrammarSlot[];
  scope: PoolScope;
  file: string;
}
export interface PoolEntry {
  id: string;
  dimensions: PoolDimensions;
  tiers?: string[];
  grammars: PoolGrammarRef[];
  fragments?: ComponentRegistry;
  scope: PoolScope;
  file: string;
}
export interface PoolsView {
  components: ComponentEntry[];
  grammars: GrammarEntry[];
  pools: PoolEntry[];
}

function baseDir(dataDir: string, scope: PoolScope, worldId: string): string {
  return scope === 'global' ? path.join(dataDir, 'global-pools') : path.join(dataDir, 'worlds', worldId);
}

/** 防目录穿越：相对文件名须以 `<已知子目录>/` 开头、不含 `..`。 */
function safeRelFile(file: string): boolean {
  const f = file.replace(/\\/g, '/');
  if (f.includes('..') || f.startsWith('/')) return false;
  const top = f.split('/')[0];
  return ['components', 'grammars', 'pools', 'scene-pools', 'topic-pools'].includes(top ?? '');
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = (await readFile(filePath, 'utf-8')).replace(/^﻿/, '');
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function listJsonRel(base: string, subdir: string): Promise<string[]> {
  const dir = path.join(base, subdir);
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  return names.filter((n) => n.toLowerCase().endsWith('.json')).map((n) => `${subdir}/${n}`);
}

function normalizeFragment(raw: unknown): Fragment {
  return typeof raw === 'string' ? { text: raw } : (raw as Fragment);
}

/** 写盘时把只有 text 的片段还原为裸字符串，保持文件简洁可读、可 diff。 */
function denormalizeFragment(f: Fragment): string | Fragment {
  return Object.keys(f).length === 1 && typeof f.text === 'string' ? f.text : f;
}

/** 读全部三层（全局 + 世界），带 provenance。 */
export async function readPools(dataDir: string, worldId: string): Promise<PoolsView> {
  const view: PoolsView = { components: [], grammars: [], pools: [] };

  for (const scope of ['global', 'world'] as const) {
    const base = baseDir(dataDir, scope, worldId);

    for (const rel of await listJsonRel(base, 'components')) {
      const obj = await readJsonFile(path.join(base, rel));
      for (const [name, frags] of Object.entries(obj)) {
        if (Array.isArray(frags)) {
          view.components.push({ name, fragments: frags.map(normalizeFragment), scope, file: rel });
        }
      }
    }

    for (const rel of await listJsonRel(base, 'grammars')) {
      const obj = await readJsonFile(path.join(base, rel));
      for (const [name, g] of Object.entries(obj)) {
        const grammar = g as Grammar;
        if (grammar && Array.isArray(grammar.slots)) {
          view.grammars.push({ name, slots: grammar.slots, scope, file: rel });
        }
      }
    }

    const poolDirs = scope === 'global' ? ['pools'] : ['scene-pools', 'topic-pools'];
    for (const sub of poolDirs) {
      for (const rel of await listJsonRel(base, sub)) {
        const obj = await readJsonFile(path.join(base, rel));
        for (const [id, bodyRaw] of Object.entries(obj)) {
          const body = bodyRaw as {
            dimensions?: PoolDimensions;
            tiers?: string[];
            grammars?: PoolGrammarRef[];
            fragments?: Record<string, unknown[]>;
          };
          if (!body || !body.dimensions || !Array.isArray(body.grammars)) continue;
          const entry: PoolEntry = {
            id,
            dimensions: body.dimensions,
            grammars: body.grammars,
            scope,
            file: rel,
          };
          if (Array.isArray(body.tiers)) entry.tiers = body.tiers;
          if (body.fragments) {
            const ov: ComponentRegistry = {};
            for (const [k, fr] of Object.entries(body.fragments)) {
              if (Array.isArray(fr)) ov[k] = fr.map(normalizeFragment);
            }
            entry.fragments = ov;
          }
          view.pools.push(entry);
        }
      }
    }
  }
  return view;
}

/** 新建条目的默认落点（世界层）。 */
function defaultFile(layer: PoolLayer): { scope: PoolScope; file: string } {
  if (layer === 'component') return { scope: 'world', file: 'components/custom.json' };
  if (layer === 'grammar') return { scope: 'world', file: 'grammars/custom.json' };
  return { scope: 'world', file: 'scene-pools/custom.json' };
}

export interface SaveInput {
  layer: PoolLayer;
  key: string;
  /** 条目主体：component=Fragment[]、grammar=Grammar、pool=池主体（无 id）。 */
  entry: unknown;
  scope?: PoolScope | undefined;
  file?: string | undefined;
}

/** 写入/更新一个条目到其来源文件（缺省落世界层默认文件）。 */
export async function saveEntry(dataDir: string, worldId: string, input: SaveInput): Promise<void> {
  const target = input.scope && input.file ? { scope: input.scope, file: input.file } : defaultFile(input.layer);
  if (!safeRelFile(target.file)) throw new Error(`非法文件路径: ${target.file}`);

  const full = path.join(baseDir(dataDir, target.scope, worldId), target.file);
  const obj = await readJsonFile(full);

  if (input.layer === 'component') {
    const frags = Array.isArray(input.entry) ? (input.entry as unknown[]).map(normalizeFragment) : [];
    obj[input.key] = frags.map(denormalizeFragment);
  } else if (input.layer === 'grammar') {
    obj[input.key] = input.entry;
  } else {
    // pool：把片段还原为裸字符串简写写盘。
    const body = { ...(input.entry as Record<string, unknown>) };
    if (body.fragments && typeof body.fragments === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, fr] of Object.entries(body.fragments as Record<string, unknown[]>)) {
        out[k] = (fr as unknown[]).map((x) => denormalizeFragment(normalizeFragment(x)));
      }
      body.fragments = out;
    }
    obj[input.key] = body;
  }

  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, JSON.stringify(obj, null, 2), 'utf-8');
}

export interface DeleteInput {
  key: string;
  scope: PoolScope;
  file: string;
}

/** 从指定来源文件删除一个条目。 */
export async function deleteEntry(dataDir: string, worldId: string, input: DeleteInput): Promise<void> {
  if (!safeRelFile(input.file)) throw new Error(`非法文件路径: ${input.file}`);
  const full = path.join(baseDir(dataDir, input.scope, worldId), input.file);
  if (!existsSync(full)) return;
  const obj = await readJsonFile(full);
  delete obj[input.key];
  await writeFile(full, JSON.stringify(obj, null, 2), 'utf-8');
}
