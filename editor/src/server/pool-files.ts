import { readFile, writeFile, mkdir, readdir, unlink, rmdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type {
  ComponentRegistry,
  Fragment,
  GrammarSlot,
  PoolDimensions,
  PoolGrammarRef,
} from '@socialsim/shared';

/**
 * 编辑器后端：读/写世界文件夹与全局层的内容池文件（1.6）。
 *
 * 配置直读文件范式：编辑器后端是改内容池配置的唯一写方，模拟器只读 + fs watch 热重载。
 * 布局：全局 `data/global-pools/{components,grammars,pools}/`、
 * 世界 `data/worlds/<id>/{components,grammars,scene-pools,topic-pools}/`。
 *
 * **一条一文件**：每个组件/语法/池各自一个 json，文件名即名字。
 * **分组 = 子文件夹**：`<层子目录>/<分组>/<名字>.json`，无分组则直接在层子目录下。
 * 分组只是组织方式（加载时拍平、名字全局唯一、不影响引用）。
 */

export type PoolScope = 'global' | 'world';
export type PoolLayer = 'component' | 'grammar' | 'pool';

interface RawSlot {
  component?: string;
  components?: string[];
  weights?: number[];
  optional?: boolean;
  prob?: number | string;
  group?: string;
}

export interface ComponentEntry { name: string; fragments: Fragment[]; scope: PoolScope; group: string }
export interface GrammarEntry { name: string; slots: GrammarSlot[]; scope: PoolScope; group: string }
export interface PoolEntry {
  id: string;
  dimensions: PoolDimensions;
  tiers?: string[];
  grammars: PoolGrammarRef[];
  fragments?: ComponentRegistry;
  scope: PoolScope;
  group: string;
}
export interface PoolsView {
  components: ComponentEntry[];
  grammars: GrammarEntry[];
  pools: PoolEntry[];
}

function baseDir(dataDir: string, scope: PoolScope, worldId: string): string {
  return scope === 'global' ? path.join(dataDir, 'global-pools') : path.join(dataDir, 'worlds', worldId);
}

/** 各层的子目录（池在世界用 scene-pools、全局用 pools）。 */
function subdirFor(layer: PoolLayer, scope: PoolScope): string {
  if (layer === 'component') return 'components';
  if (layer === 'grammar') return 'grammars';
  return scope === 'global' ? 'pools' : 'scene-pools';
}

/** 文件名/分组名安全化：剔除路径非法字符，保留中文。 */
function safeSeg(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim();
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

/** 递归列出某子目录下所有 .json，返回 [分组, 绝对路径]（分组 = 子目录相对路径，无则 ''）。 */
async function listGrouped(base: string, subdir: string): Promise<Array<{ group: string; full: string }>> {
  const root = path.join(base, subdir);
  if (!existsSync(root)) return [];
  const out: Array<{ group: string; full: string }> = [];
  async function walk(dir: string, group: string): Promise<void> {
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) await walk(path.join(dir, ent.name), group ? `${group}/${ent.name}` : ent.name);
      else if (ent.name.toLowerCase().endsWith('.json')) out.push({ group, full: path.join(dir, ent.name) });
    }
  }
  await walk(root, '');
  return out;
}

function normalizeFragment(raw: unknown): Fragment {
  return typeof raw === 'string' ? { text: raw } : (raw as Fragment);
}
function denormalizeFragment(f: Fragment): string | Fragment {
  return Object.keys(f).length === 1 && typeof f.text === 'string' ? f.text : f;
}
function normalizeSlot(raw: RawSlot): GrammarSlot {
  const components = raw.components ?? (raw.component !== undefined ? [raw.component] : []);
  const slot: GrammarSlot = { components };
  if (Array.isArray(raw.weights)) slot.weights = raw.weights;
  if (raw.optional) slot.optional = true;
  if (raw.prob !== undefined) slot.prob = raw.prob;
  if (raw.group !== undefined && raw.group !== '') slot.group = raw.group;
  return slot;
}

/** 读全部三层（全局 + 世界），带 provenance（scope + 分组）。 */
export async function readPools(dataDir: string, worldId: string): Promise<PoolsView> {
  const view: PoolsView = { components: [], grammars: [], pools: [] };

  for (const scope of ['global', 'world'] as const) {
    const base = baseDir(dataDir, scope, worldId);

    for (const { group, full } of await listGrouped(base, 'components')) {
      const obj = await readJsonFile(full);
      for (const [name, frags] of Object.entries(obj)) {
        if (Array.isArray(frags)) view.components.push({ name, fragments: frags.map(normalizeFragment), scope, group });
      }
    }

    for (const { group, full } of await listGrouped(base, 'grammars')) {
      const obj = await readJsonFile(full);
      for (const [name, g] of Object.entries(obj)) {
        const grammar = g as { slots?: RawSlot[] };
        if (grammar && Array.isArray(grammar.slots)) {
          view.grammars.push({ name, slots: grammar.slots.map(normalizeSlot), scope, group });
        }
      }
    }

    const poolDirs = scope === 'global' ? ['pools'] : ['scene-pools', 'topic-pools'];
    for (const sub of poolDirs) {
      for (const { group, full } of await listGrouped(base, sub)) {
        const obj = await readJsonFile(full);
        for (const [id, bodyRaw] of Object.entries(obj)) {
          const body = bodyRaw as {
            dimensions?: PoolDimensions;
            tiers?: string[];
            grammars?: PoolGrammarRef[];
            fragments?: Record<string, unknown[]>;
          };
          if (!body || !body.dimensions || !Array.isArray(body.grammars)) continue;
          const entry: PoolEntry = { id, dimensions: body.dimensions, grammars: body.grammars, scope, group };
          if (Array.isArray(body.tiers)) entry.tiers = body.tiers;
          if (body.fragments) {
            const ov: ComponentRegistry = {};
            for (const [k, fr] of Object.entries(body.fragments)) if (Array.isArray(fr)) ov[k] = fr.map(normalizeFragment);
            entry.fragments = ov;
          }
          view.pools.push(entry);
        }
      }
    }
  }
  return view;
}

/** 条目文件路径：`<层子目录>/<分组?>/<名字>.json`。 */
function entryFile(dataDir: string, worldId: string, layer: PoolLayer, scope: PoolScope, group: string, key: string): string {
  const segs = [baseDir(dataDir, scope, worldId), subdirFor(layer, scope)];
  const g = group.split('/').map(safeSeg).filter(Boolean);
  segs.push(...g, `${safeSeg(key)}.json`);
  return path.join(...segs);
}

export interface SaveInput {
  layer: PoolLayer;
  key: string;
  /** 条目主体：component=Fragment[]、grammar={slots}、pool=池主体（无 id）。 */
  entry: unknown;
  scope?: PoolScope | undefined;
  /** 分组（子文件夹），缺省=无分组。 */
  group?: string | undefined;
}

/** 写入/更新一个条目，落 `<层子目录>/<分组?>/<名字>.json`（一条一文件）。 */
export async function saveEntry(dataDir: string, worldId: string, input: SaveInput): Promise<void> {
  const scope = input.scope ?? 'world';
  if (!safeSeg(input.key)) throw new Error('条目名不能为空');
  const full = entryFile(dataDir, worldId, input.layer, scope, input.group ?? '', input.key);

  let body: unknown;
  if (input.layer === 'component') {
    const frags = Array.isArray(input.entry) ? (input.entry as unknown[]).map(normalizeFragment) : [];
    body = frags.map(denormalizeFragment);
  } else if (input.layer === 'grammar') {
    body = input.entry;
  } else {
    body = denormalizePoolBody(input.entry as Record<string, unknown>);
  }

  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, JSON.stringify({ [input.key]: body }, null, 2), 'utf-8');
}

function denormalizePoolBody(entry: Record<string, unknown>): Record<string, unknown> {
  const body = { ...entry };
  if (body.fragments && typeof body.fragments === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, fr] of Object.entries(body.fragments as Record<string, unknown[]>)) {
      out[k] = (fr as unknown[]).map((x) => denormalizeFragment(normalizeFragment(x)));
    }
    body.fragments = out;
  }
  return body;
}

export interface DeleteInput {
  layer: PoolLayer;
  key: string;
  scope: PoolScope;
  group?: string | undefined;
}

/** 删除一个条目：删其 `<分组?>/<名字>.json`（若该文件还含其它条目则仅删该键）；删后清理空分组文件夹。 */
export async function deleteEntry(dataDir: string, worldId: string, input: DeleteInput): Promise<void> {
  const full = entryFile(dataDir, worldId, input.layer, input.scope, input.group ?? '', input.key);
  if (!existsSync(full)) return;
  const obj = await readJsonFile(full);
  delete obj[input.key];
  if (Object.keys(obj).length === 0) {
    await unlink(full);
    // 自下而上清理变空的分组文件夹，止于层子目录（如 components/scene-pools）。
    const stop = path.join(baseDir(dataDir, input.scope, worldId), subdirFor(input.layer, input.scope));
    let dir = path.dirname(full);
    while (dir !== stop && dir.startsWith(stop)) {
      try { await rmdir(dir); } catch { break; } // 非空则停
      dir = path.dirname(dir);
    }
  } else {
    await writeFile(full, JSON.stringify(obj, null, 2), 'utf-8');
  }
}
