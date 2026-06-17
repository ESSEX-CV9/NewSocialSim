import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
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
 * 文件布局：全局 `data/global-pools/{components,grammars,pools}/`、
 * 世界 `data/worlds/<id>/{components,grammars,scene-pools,topic-pools}/`。
 *
 * **一条一文件**：每个组件 / 语法 / 池各自一个 json，文件名即其名字（如 `grammars/感叹式.json`）。
 * 保存按 名字 + 层 + 层级（全局/世界）推导落点，作者无需关心文件归属。
 */

export type PoolScope = 'global' | 'world';
export type PoolLayer = 'component' | 'grammar' | 'pool';

/** 盘上槽位允许旧写法 `{ component }` 或新写法 `{ components }`；读时归一化为 GrammarSlot。 */
interface RawSlot {
  component?: string;
  components?: string[];
  weights?: number[];
  optional?: boolean;
  prob?: number | string;
  group?: string;
}

export interface ComponentEntry { name: string; fragments: Fragment[]; scope: PoolScope; file: string }
export interface GrammarEntry { name: string; slots: GrammarSlot[]; scope: PoolScope; file: string }
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

/** 各层的子目录（池在世界用 scene-pools、全局用 pools）。 */
function subdirFor(layer: PoolLayer, scope: PoolScope): string {
  if (layer === 'component') return 'components';
  if (layer === 'grammar') return 'grammars';
  return scope === 'global' ? 'pools' : 'scene-pools';
}

/** 文件名安全化：剔除路径非法字符，保留中文。 */
function safeName(name: string): string {
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

/** 槽位归一化：旧 `component` → `components:[..]`；保留 weights/optional/prob/group。 */
function normalizeSlot(raw: RawSlot): GrammarSlot {
  const components = raw.components ?? (raw.component !== undefined ? [raw.component] : []);
  const slot: GrammarSlot = { components };
  if (Array.isArray(raw.weights)) slot.weights = raw.weights;
  if (raw.optional) slot.optional = true;
  if (raw.prob !== undefined) slot.prob = raw.prob;
  if (raw.group !== undefined && raw.group !== '') slot.group = raw.group;
  return slot;
}

/** 读全部三层（全局 + 世界），带 provenance（scope + 相对文件路径）。 */
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
        const grammar = g as { slots?: RawSlot[] };
        if (grammar && Array.isArray(grammar.slots)) {
          view.grammars.push({ name, slots: grammar.slots.map(normalizeSlot), scope, file: rel });
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
          const entry: PoolEntry = { id, dimensions: body.dimensions, grammars: body.grammars, scope, file: rel };
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

export interface SaveInput {
  layer: PoolLayer;
  key: string;
  /** 条目主体：component=Fragment[]、grammar={slots}、pool=池主体（无 id）。 */
  entry: unknown;
  /** 落在全局层还是世界层；缺省世界层。 */
  scope?: PoolScope | undefined;
}

/** 写入/更新一个条目，落 `<层子目录>/<名字>.json`（一条一文件）。 */
export async function saveEntry(dataDir: string, worldId: string, input: SaveInput): Promise<void> {
  const scope = input.scope ?? 'world';
  const name = safeName(input.key);
  if (!name) throw new Error('条目名不能为空');
  const full = path.join(baseDir(dataDir, scope, worldId), subdirFor(input.layer, scope), `${name}.json`);

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

/** 池主体里的池级片段覆盖还原为裸字符串简写。 */
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
}

/** 删除一个条目：删其 `<名字>.json`（若该文件还含其它条目则仅删该键）。 */
export async function deleteEntry(dataDir: string, worldId: string, input: DeleteInput): Promise<void> {
  const name = safeName(input.key);
  const full = path.join(baseDir(dataDir, input.scope, worldId), subdirFor(input.layer, input.scope), `${name}.json`);
  if (!existsSync(full)) return;
  const obj = await readJsonFile(full);
  delete obj[input.key];
  if (Object.keys(obj).length === 0) await unlink(full);
  else await writeFile(full, JSON.stringify(obj, null, 2), 'utf-8');
}
