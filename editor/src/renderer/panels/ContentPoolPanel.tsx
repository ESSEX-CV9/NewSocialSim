import { useCallback, useEffect, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import type { Fragment, GrammarSlot, PoolGrammarRef } from '@socialsim/shared';
import { runPreview } from '../state/preview-bus.js';

/**
 * 内容池面板（单一面板）：一个内容池浏览器——可切 池/语法/组件 tab，分组列表 + 编辑器。
 * 语法用卡片条编辑：组件可从另一个内容池面板（组件 tab）拖入槽位；槽位详情用小选择窗选组件、
 * 用勾选其它槽位来组互斥组。组件/语法/池都支持分组（=子文件夹）。
 *
 * 布局（左内容池 | 右上内容池 | 右下预览器）由 dockview 预设布局编排（layouts/presets「内容池」），
 * 预览结果经 preview-bus 推到独立的预览器面板，不在本面板内部出。
 * 默认 tab 可由 dockview 面板参数 `params.tab` 指定（预设用它让右侧那格默认组件 tab）。
 */

type Scope = 'global' | 'world';
type Tab = 'pool' | 'grammar' | 'component';
interface ComponentEntry { name: string; fragments: Fragment[]; scope: Scope; group: string }
interface GrammarEntry { name: string; slots: GrammarSlot[]; scope: Scope; group: string }
interface PoolEntry { id: string; dimensions: Record<string, string>; tiers?: string[]; grammars: PoolGrammarRef[]; fragments?: Record<string, Fragment[]>; scope: Scope; group: string }
interface PoolsView { components: ComponentEntry[]; grammars: GrammarEntry[]; pools: PoolEntry[] }

const TIERS = ['core', 'ambient'];
const NEW = ' new';
const input = 'bg-(--chip) border border-(--border) rounded px-2 py-1 text-xs text-(--text) outline-none focus:border-(--blue)';
const btn = 'px-2 py-1 text-xs rounded-lg bg-(--chip) border border-(--border) text-(--text) hover:bg-[#2a2e33] cursor-pointer';
const btnPrimary = 'px-2 py-1 text-xs rounded-lg bg-(--blue) border border-(--blue) text-white cursor-pointer';
const DND_COMPONENT = 'application/x-pool-component';

function api(path: string, body?: unknown): Promise<Response> {
  const url = `${window.editor.backendUrl}${path}`;
  if (body === undefined) return fetch(url);
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

const GROUP_COLORS = ['#e0a458', '#6cb6ff', '#7ee787', '#ff7b72', '#d2a8ff', '#79c0ff'];
function colorOf(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return GROUP_COLORS[h % GROUP_COLORS.length]!;
}

export function ContentPoolPanel(props: IDockviewPanelProps) {
  const [view, setView] = useState<PoolsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const defaultTab = ((props.params as { tab?: Tab } | undefined)?.tab) ?? 'grammar';

  const load = useCallback(async () => {
    try {
      const res = await api('/api/content-pools');
      if (!res.ok) throw new Error(`backend ${res.status}`);
      setView((await res.json()) as PoolsView);
      setError(null);
    } catch (e) { setError(String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (error) return <div className="p-3.5"><p className="text-(--pink) text-sm">编辑器后端不可达：{error}</p></div>;
  if (!view) return <div className="p-3.5"><p className="text-(--dim) text-sm">加载中…</p></div>;

  return <PoolBrowser view={view} defaultTab={defaultTab} onSaved={load} onPreview={runPreview} />;
}

// ============ 内容池浏览器 ============

interface BrowserProps {
  view: PoolsView;
  defaultTab: Tab;
  onSaved: () => Promise<void> | void;
  onPreview: (pool: unknown, grammars?: Record<string, unknown>) => void;
}

type PreviewFn = (pool: unknown, grammars?: Record<string, unknown>) => void;
interface EditorProps { view: PoolsView; sel: string; onSaved: () => Promise<void> | void; onSelect: (k: string) => void }

function PoolBrowser({ view, defaultTab, onSaved, onPreview }: BrowserProps) {
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [sel, setSel] = useState<string | null>(null);

  const items: { key: string; scope: Scope; group: string; sub: string }[] =
    tab === 'pool' ? view.pools.map((p) => ({ key: p.id, scope: p.scope, group: p.group, sub: dimLabel(p.dimensions) }))
    : tab === 'grammar' ? view.grammars.map((g) => ({ key: g.name, scope: g.scope, group: g.group, sub: `${g.slots.length} 槽` }))
    : view.components.map((c) => ({ key: c.name, scope: c.scope, group: c.group, sub: `${c.fragments.length} 片段` }));

  const layer = tab === 'pool' ? 'pool' : tab === 'grammar' ? 'grammar' : 'component';

  async function moveTo(key: string, scope: Scope, fromGroup: string, toGroup: string) {
    if (fromGroup === toGroup) return;
    const entry = findEntryBody(view, layer, key);
    if (entry === undefined) return;
    await api('/api/content-pools/save', { layer, key, entry, scope, group: toGroup });
    await api('/api/content-pools/delete', { layer, key, scope, group: fromGroup });
    await onSaved();
  }

  return (
    <div className="flex h-full">
      {/* 左栏：tab + 分组列表 */}
      <div className="w-60 shrink-0 border-r border-(--border) flex flex-col min-h-0">
        <div className="flex border-b border-(--border) shrink-0">
          {(['pool', 'grammar', 'component'] as Tab[]).map((t) => (
            <button key={t} className={`flex-1 py-2 text-xs cursor-pointer ${tab === t ? 'text-(--text) border-b-2 border-(--blue)' : 'text-(--dim)'}`} onClick={() => { setTab(t); setSel(null); }}>
              {t === 'pool' ? '池' : t === 'grammar' ? '语法' : '组件'}
            </button>
          ))}
        </div>
        <GroupedList items={items} layer={layer} sel={sel} onSelect={setSel} onMove={moveTo} />
      </div>
      {/* 右栏：编辑器 */}
      <div className="flex-1 overflow-y-auto min-w-0">
        {sel === null && <p className="text-(--dim) text-xs p-3">选一项编辑，或点左侧「新建」。</p>}
        {sel !== null && tab === 'pool' && <PoolEditor view={view} sel={sel} onSaved={onSaved} onSelect={setSel} onPreview={onPreview} />}
        {sel !== null && tab === 'grammar' && <GrammarEditor view={view} sel={sel} onSaved={onSaved} onSelect={setSel} onPreview={onPreview} />}
        {sel !== null && tab === 'component' && <ComponentEditor view={view} sel={sel} onSaved={onSaved} onSelect={setSel} />}
      </div>
    </div>
  );
}

function GroupedList({ items, layer, sel, onSelect, onMove }: {
  items: { key: string; scope: Scope; group: string; sub: string }[];
  layer: 'pool' | 'grammar' | 'component';
  sel: string | null;
  onSelect: (k: string) => void;
  onMove: (key: string, scope: Scope, fromGroup: string, toGroup: string) => void;
}) {
  const groups = [...new Set(items.map((it) => it.group))].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dropG, setDropG] = useState<string | null>(null);

  function onDropTo(g: string, e: React.DragEvent) {
    e.preventDefault(); setDropG(null);
    const raw = e.dataTransfer.getData('application/x-pool-move');
    if (!raw) return;
    try { const m = JSON.parse(raw) as { layer: string; key: string; scope: Scope; group: string }; if (m.layer === layer) onMove(m.key, m.scope, m.group, g); } catch { /* ignore */ }
  }

  return (
    <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1 min-h-0">
      <button className={`${btn} w-full mb-1`} onClick={() => onSelect(NEW)}><i className="ri-add-line" /> 新建</button>
      {groups.map((g) => (
        <div key={g}>
          <div
            className={`flex items-center gap-1 text-[11px] text-(--dim) px-1 py-0.5 rounded ${dropG === g ? 'bg-(--blue) text-white' : ''}`}
            onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-pool-move')) { e.preventDefault(); setDropG(g); } }}
            onDragLeave={() => setDropG((p) => (p === g ? null : p))}
            onDrop={(e) => onDropTo(g, e)}
          >
            <button onClick={() => setCollapsed((c) => ({ ...c, [g]: !c[g] }))} className="cursor-pointer">
              <i className={collapsed[g] ? 'ri-arrow-right-s-line' : 'ri-arrow-down-s-line'} />
            </button>
            <span className="truncate">{g === '' ? '未分组' : g}</span>
            <span className="ml-auto opacity-60">{items.filter((it) => it.group === g).length}</span>
          </div>
          {!collapsed[g] && items.filter((it) => it.group === g).map((it) => (
            <button
              key={it.key}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-pool-move', JSON.stringify({ layer, key: it.key, scope: it.scope, group: it.group }));
                if (layer === 'component') e.dataTransfer.setData(DND_COMPONENT, it.key);
              }}
              className={`w-full text-left pl-5 pr-2 py-1 rounded-lg border text-xs cursor-pointer ${sel === it.key ? 'bg-(--chip) border-(--blue)' : 'bg-transparent border-(--border) hover:bg-(--chip)'}`}
              onClick={() => onSelect(it.key)}
            >
              <div className="flex items-center gap-1.5">
                <span className="truncate">{it.key}</span>
                {it.scope === 'global' && <span className="ml-auto text-[10px] text-(--amber)" title="全局层">全局</span>}
              </div>
              <div className="text-(--dim) text-[11px] truncate">{it.sub}</div>
            </button>
          ))}
        </div>
      ))}
      {!items.length && <p className="text-(--dim) text-xs px-1 py-2">暂无，点「新建」。</p>}
    </div>
  );
}

function dimLabel(d: Record<string, string>): string {
  return Object.entries(d).map(([k, v]) => `${k}=${v}`).join(' · ');
}
function findEntryBody(view: PoolsView, layer: string, key: string): unknown {
  if (layer === 'component') { const c = view.components.find((x) => x.name === key); return c ? c.fragments.map((f) => (Object.keys(f).length === 1 ? f.text : f)) : undefined; }
  if (layer === 'grammar') { const g = view.grammars.find((x) => x.name === key); return g ? { slots: g.slots } : undefined; }
  const p = view.pools.find((x) => x.id === key);
  if (!p) return undefined;
  const body: Record<string, unknown> = { dimensions: p.dimensions, grammars: p.grammars };
  if (p.tiers) body.tiers = p.tiers;
  if (p.fragments) body.fragments = p.fragments;
  return body;
}
function groupsOf(view: PoolsView, layer: string, scope: Scope): string[] {
  const arr = layer === 'component' ? view.components : layer === 'grammar' ? view.grammars : view.pools;
  return [...new Set(arr.filter((e) => e.scope === scope && e.group).map((e) => e.group))].sort();
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-(--dim) text-[11px] mb-1">{label}</label>{children}</div>;
}
function GroupField({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <Field label="分组（留空=未分组；输入新名=新建分组）">
      <input className={`${input} w-60`} value={value} list="grp-opts" placeholder="分组名" onChange={(e) => onChange(e.target.value)} />
      <datalist id="grp-opts">{options.map((g) => <option key={g} value={g} />)}</datalist>
    </Field>
  );
}

// ============ 池编辑器 ============

function PoolEditor({ view, sel, onSaved, onSelect, onPreview }: EditorProps & { onPreview: PreviewFn }) {
  const existing = sel === NEW ? null : view.pools.find((p) => p.id === sel) ?? null;
  const [id, setId] = useState('');
  const [dims, setDims] = useState<[string, string][]>([]);
  const [tiers, setTiers] = useState<string[]>([]);
  const [grammars, setGrammars] = useState<{ ref: string; weight: number }[]>([]);
  const [group, setGroup] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setMsg(null);
    if (existing) { setId(existing.id); setDims(Object.entries(existing.dimensions)); setTiers(existing.tiers ?? []); setGrammars(existing.grammars.map((g) => ({ ref: g.ref, weight: g.weight ?? 1 }))); setGroup(existing.group); }
    else { setId(''); setDims([['形态', 'standalone']]); setTiers([]); setGrammars([]); setGroup(''); }
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  function build() {
    const dimensions: Record<string, string> = {};
    for (const [k, v] of dims) if (k.trim()) dimensions[k.trim()] = v;
    return { id: id.trim(), dimensions, tiers, grammars: grammars.filter((g) => g.ref.trim()).map((g) => ({ ref: g.ref.trim(), weight: g.weight })) };
  }
  async function save() {
    const p = build();
    if (!p.id) { setMsg('请填池子名。'); return; }
    const res = await api('/api/content-pools/save', { layer: 'pool', key: p.id, entry: { dimensions: p.dimensions, tiers: p.tiers, grammars: p.grammars }, scope: existing?.scope, group });
    if (!res.ok) { setMsg(`保存失败：${res.status}`); return; }
    if (existing && existing.group !== group) await api('/api/content-pools/delete', { layer: 'pool', key: p.id, scope: existing.scope, group: existing.group });
    setMsg('已保存（模拟器热重载即生效）。'); await onSaved(); onSelect(p.id);
  }
  async function remove() {
    if (!existing) return;
    const res = await api('/api/content-pools/delete', { layer: 'pool', key: existing.id, scope: existing.scope, group: existing.group });
    if (res.ok) { await onSaved(); onSelect(NEW); } else setMsg(`删除失败：${res.status}`);
  }

  return (
    <div className="space-y-3 p-3">
      <Field label="池子名"><input className={`${input} w-full`} value={id} onChange={(e) => setId(e.target.value)} placeholder="池子名（建议 类型-语气-篇幅）" disabled={!!existing} /></Field>
      <GroupField value={group} onChange={setGroup} options={groupsOf(view, 'pool', existing?.scope ?? 'world')} />
      <Field label="维度（如 领域 / 模式 / 形态）">
        {dims.map(([k, v], i) => (
          <div key={i} className="flex gap-1.5 mb-1">
            <input className={`${input} w-32`} value={k} placeholder="键" onChange={(e) => setDims(dims.map((d, j) => (j === i ? [e.target.value, d[1]] : d)))} />
            <input className={`${input} flex-1`} value={v} placeholder="值" onChange={(e) => setDims(dims.map((d, j) => (j === i ? [d[0], e.target.value] : d)))} />
            <button className={btn} onClick={() => setDims(dims.filter((_, j) => j !== i))}><i className="ri-delete-bin-line" /></button>
          </div>
        ))}
        <button className={btn} onClick={() => setDims([...dims, ['', '']])}><i className="ri-add-line" /> 加维度</button>
      </Field>
      <Field label="准用账号类型（没勾 = 谁都不能用）">
        <div className="flex gap-3">
          {TIERS.map((t) => (
            <label key={t} className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input type="checkbox" checked={tiers.includes(t)} onChange={(e) => setTiers(e.target.checked ? [...tiers, t] : tiers.filter((x) => x !== t))} />
              {t === 'core' ? '核心号 (core)' : '氛围号 (ambient)'}
            </label>
          ))}
        </div>
      </Field>
      <Field label="语法（引用 + 权重）">
        {grammars.map((g, i) => (
          <div key={i} className="flex gap-1.5 mb-1">
            <select className={`${input} flex-1`} value={g.ref} onChange={(e) => setGrammars(grammars.map((x, j) => (j === i ? { ...x, ref: e.target.value } : x)))}>
              <option value="">（选语法）</option>
              {view.grammars.map((gr) => <option key={gr.name} value={gr.name}>{gr.name}</option>)}
            </select>
            <input className={`${input} w-16`} type="number" step="0.1" value={g.weight} onChange={(e) => setGrammars(grammars.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))} />
            <button className={btn} onClick={() => setGrammars(grammars.filter((_, j) => j !== i))}><i className="ri-delete-bin-line" /></button>
          </div>
        ))}
        <button className={btn} onClick={() => setGrammars([...grammars, { ref: '', weight: 1 }])}><i className="ri-add-line" /> 加语法</button>
      </Field>
      <div className="flex items-center gap-2 pt-1">
        <button className={btnPrimary} onClick={() => { const p = build(); if (!p.grammars.length) { setMsg('先加至少一个语法再预览。'); return; } onPreview(p); }}><i className="ri-eye-line" /> 预览</button>
        <button className={btn} onClick={() => void save()}><i className="ri-save-line" /> 保存</button>
        {existing && <button className={`${btn} text-(--pink)`} onClick={() => void remove()}><i className="ri-delete-bin-line" /> 删除</button>}
      </div>
      {msg && <p className="text-(--dim) text-xs">{msg}</p>}
    </div>
  );
}

// ============ 语法编辑器（卡片条 + 拖入 + 槽位详情）============

interface EditSlot { components: string[]; pct: number; group: string; expr: string }

function GrammarEditor({ view, sel, onSaved, onSelect, onPreview }: EditorProps & { onPreview: PreviewFn }) {
  const existing = sel === NEW ? null : view.grammars.find((g) => g.name === sel) ?? null;
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [slots, setSlots] = useState<EditSlot[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [picker, setPicker] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setMsg(null); setEditing(null); setPicker(false);
    if (existing) {
      setName(existing.name); setGroup(existing.group);
      setSlots(existing.slots.map((s) => ({ components: s.components, group: s.group ?? '', expr: typeof s.prob === 'string' ? s.prob : '', pct: typeof s.prob === 'number' ? Math.round(s.prob * 100) : s.optional ? 50 : 100 })));
    } else { setName(''); setGroup(''); setSlots([]); }
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  function setSlot(i: number, patch: Partial<EditSlot>) { setSlots((arr) => arr.map((s, j) => (j === i ? { ...s, ...patch } : s))); }
  function move(i: number, d: number) { const j = i + d; if (j < 0 || j >= slots.length) return; const a = [...slots]; [a[i], a[j]] = [a[j]!, a[i]!]; setSlots(a); setEditing(j); }
  function addSlot(comp?: string) { setSlots((a) => [...a, { components: comp ? [comp] : [], pct: 100, group: '', expr: '' }]); }
  function dropOnSlot(i: number, e: React.DragEvent) {
    const c = e.dataTransfer.getData(DND_COMPONENT); if (!c) return; e.preventDefault();
    setSlot(i, { components: slots[i]!.components.includes(c) ? slots[i]!.components : [...slots[i]!.components, c] });
  }

  // 互斥组：勾选其它槽位 → 共享一个自动组 id
  function toggleExclusive(i: number, j: number) {
    setSlots((arr) => {
      const a = arr.map((s) => ({ ...s }));
      const same = a[i]!.group && a[i]!.group === a[j]!.group;
      if (same) { a[j]!.group = ''; }
      else { const gid = a[i]!.group || a[j]!.group || nextGid(a); a[i]!.group = gid; a[j]!.group = gid; }
      // 清理：组内 <2 成员则解散
      for (const gid of new Set(a.map((s) => s.group).filter(Boolean))) {
        if (a.filter((s) => s.group === gid).length < 2) a.forEach((s) => { if (s.group === gid) s.group = ''; });
      }
      return a;
    });
  }

  function buildSlots(): GrammarSlot[] {
    return slots.filter((s) => s.components.length).map((s) => {
      const slot: GrammarSlot = { components: s.components };
      if (s.group.trim()) slot.group = s.group.trim();
      if (s.expr.trim()) slot.prob = s.expr.trim();
      else if (s.pct < 100) slot.prob = Number((s.pct / 100).toFixed(3));
      return slot;
    });
  }
  async function save() {
    if (!name.trim()) { setMsg('请填语法名。'); return; }
    const res = await api('/api/content-pools/save', { layer: 'grammar', key: name.trim(), entry: { slots: buildSlots() }, scope: existing?.scope, group });
    if (!res.ok) { setMsg(`保存失败：${res.status}`); return; }
    if (existing && existing.group !== group) await api('/api/content-pools/delete', { layer: 'grammar', key: name.trim(), scope: existing.scope, group: existing.group });
    setMsg('已保存。'); await onSaved(); onSelect(name.trim());
  }
  async function remove() {
    if (!existing) return;
    const res = await api('/api/content-pools/delete', { layer: 'grammar', key: existing.name, scope: existing.scope, group: existing.group });
    if (res.ok) { await onSaved(); onSelect(NEW); } else setMsg(`删除失败：${res.status}`);
  }
  function doPreview() {
    const built = buildSlots(); if (!built.length) { setMsg('先加至少一个有组件的槽位。'); return; }
    const gname = name.trim() || '_preview_g';
    onPreview({ id: '_preview', dimensions: { 形态: 'standalone' }, grammars: [{ ref: gname }] }, { [gname]: { slots: built } });
  }

  return (
    <div className="space-y-3 p-3">
      <div className="flex gap-3 flex-wrap">
        <Field label="语法名"><input className={`${input} w-52`} value={name} onChange={(e) => setName(e.target.value)} placeholder="语法名" disabled={!!existing} /></Field>
        <GroupField value={group} onChange={setGroup} options={groupsOf(view, 'grammar', existing?.scope ?? 'world')} />
      </div>

      <Field label="槽位（左→右=成文顺序；从右上组件区可拖入；点卡片编辑）">
        <div className="flex flex-wrap items-stretch gap-1.5">
          {slots.map((s, i) => {
            const badge = [s.group ? '互斥' : '', s.expr.trim() ? '高级' : s.pct < 100 ? `${s.pct}%` : ''].filter(Boolean).join(' · ') || '总是';
            const col = s.group ? colorOf(s.group) : 'var(--dim)';
            return (
              <div key={i} className="flex items-center gap-1">
                <div
                  className={`min-w-24 max-w-44 rounded-lg border px-2 py-1.5 cursor-pointer ${editing === i ? 'border-(--blue) bg-(--chip)' : 'border-(--border) bg-(--panel)'}`}
                  onClick={() => setEditing(editing === i ? null : i)}
                  onDragOver={(e) => { if (e.dataTransfer.types.includes(DND_COMPONENT)) e.preventDefault(); }}
                  onDrop={(e) => dropOnSlot(i, e)}
                >
                  <div className="text-xs truncate">{s.components.length ? s.components.join(' · ') : <span className="text-(--pink)">拖组件进来</span>}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: col }}>{badge}{s.components.length > 1 ? ' · 多选一' : ''}</div>
                  <div className="flex gap-1 mt-1 text-(--dim)">
                    <button title="左移" onClick={(e) => { e.stopPropagation(); move(i, -1); }}><i className="ri-arrow-left-s-line" /></button>
                    <button title="右移" onClick={(e) => { e.stopPropagation(); move(i, 1); }}><i className="ri-arrow-right-s-line" /></button>
                    <button title="删除" className="ml-auto text-(--pink)" onClick={(e) => { e.stopPropagation(); setSlots(slots.filter((_, j) => j !== i)); setEditing(null); }}><i className="ri-close-line" /></button>
                  </div>
                </div>
                {i < slots.length - 1 && <i className="ri-arrow-right-line text-(--dim)" />}
              </div>
            );
          })}
          <div
            className="min-w-20 self-stretch rounded-lg border border-dashed border-(--border) flex items-center justify-center text-(--dim) text-xs cursor-pointer hover:border-(--blue)"
            onClick={() => { addSlot(); setEditing(slots.length); }}
            onDragOver={(e) => { if (e.dataTransfer.types.includes(DND_COMPONENT)) e.preventDefault(); }}
            onDrop={(e) => { const c = e.dataTransfer.getData(DND_COMPONENT); if (c) { e.preventDefault(); addSlot(c); } }}
          >
            <i className="ri-add-line" /> 加槽位
          </div>
        </div>
      </Field>

      {editing !== null && slots[editing] && (
        <div className="bg-(--panel) border border-(--border) rounded-xl p-3 space-y-2.5">
          <div className="text-xs font-semibold">槽位 {editing + 1} 设置</div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-(--dim) text-[11px]">组件：</span>
            {slots[editing]!.components.map((c) => (
              <span key={c} className="px-2 py-0.5 rounded-full text-xs bg-(--blue) text-white flex items-center gap-1">
                {c}<button onClick={() => setSlot(editing, { components: slots[editing]!.components.filter((x) => x !== c) })}><i className="ri-close-line" /></button>
              </span>
            ))}
            <button className={btn} onClick={() => setPicker(true)}><i className="ri-add-line" /> 选组件</button>
            {slots[editing]!.components.length > 1 && <span className="text-(--dim) text-[11px]">（多个 = 多选一）</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-(--dim) text-[11px] w-16">出现概率</span>
            <input type="range" min={0} max={100} value={slots[editing]!.pct} onChange={(e) => setSlot(editing, { pct: Number(e.target.value) })} />
            <span className="text-xs w-10 text-right">{slots[editing]!.pct}%</span>
            {slots[editing]!.group && <span className="text-(--dim) text-[11px]">（互斥组里也按各自概率掷，至多出一个）</span>}
          </div>
          <div>
            <div className="text-(--dim) text-[11px] mb-1">与哪些槽位互斥（同组至多出一个）</div>
            <div className="flex flex-wrap gap-1.5">
              {slots.map((s, j) => {
                if (j === editing) return null;
                const on = !!slots[editing]!.group && slots[editing]!.group === s.group;
                return (
                  <button
                    key={j}
                    onClick={() => toggleExclusive(editing, j)}
                    className={`px-2 py-0.5 rounded-full text-xs border cursor-pointer ${on ? 'bg-(--blue) border-(--blue) text-white' : 'bg-(--chip) border-(--border) text-(--text)'}`}
                  >
                    槽{j + 1} {s.components[0] ?? '空'}
                  </button>
                );
              })}
              {slots.length < 2 && <span className="text-(--dim) text-[11px]">至少两个槽位才能组互斥</span>}
            </div>
          </div>
          <details>
            <summary className="text-(--dim) text-[11px] cursor-pointer">高级：概率表达式</summary>
            <input className={`${input} w-72 mt-1`} value={slots[editing]!.expr} placeholder="如 slangDensity（覆盖上面的百分比）" onChange={(e) => setSlot(editing, { expr: e.target.value })} />
          </details>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button className={btnPrimary} onClick={doPreview}><i className="ri-eye-line" /> 预览</button>
        <button className={btn} onClick={() => void save()}><i className="ri-save-line" /> 保存</button>
        {existing && <button className={`${btn} text-(--pink)`} onClick={() => void remove()}><i className="ri-delete-bin-line" /> 删除</button>}
      </div>
      {msg && <p className="text-(--dim) text-xs">{msg}</p>}

      {picker && editing !== null && (
        <ComponentPicker
          view={view}
          selected={slots[editing]!.components}
          onToggle={(c) => setSlot(editing, { components: slots[editing]!.components.includes(c) ? slots[editing]!.components.filter((x) => x !== c) : [...slots[editing]!.components, c] })}
          onClose={() => setPicker(false)}
        />
      )}
    </div>
  );
}

function nextGid(slots: { group: string }[]): string {
  let n = 1;
  const used = new Set(slots.map((s) => s.group).filter(Boolean));
  while (used.has(`g${n}`)) n++;
  return `g${n}`;
}

// 组件小选择窗（按分组、可搜索、勾选）
function ComponentPicker({ view, selected, onToggle, onClose }: { view: PoolsView; selected: string[]; onToggle: (c: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const comps = view.components.filter((c) => c.name.includes(q));
  const groups = [...new Set(comps.map((c) => c.group))].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-(--panel) border border-(--border) rounded-xl p-3 w-96 max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-2">
          <i className="ri-search-line text-(--dim)" />
          <input autoFocus className={`${input} flex-1`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜组件" />
          <button className={btn} onClick={onClose}>完成</button>
        </div>
        <div className="overflow-y-auto space-y-2">
          {groups.map((g) => (
            <div key={g}>
              <div className="text-[11px] text-(--dim) mb-1">{g === '' ? '未分组' : g}</div>
              <div className="flex flex-wrap gap-1.5">
                {comps.filter((c) => c.group === g).map((c) => {
                  const on = selected.includes(c.name);
                  return <button key={c.name + c.scope} className={`px-2 py-0.5 rounded-full text-xs border cursor-pointer ${on ? 'bg-(--blue) border-(--blue) text-white' : 'bg-(--chip) border-(--border)'}`} onClick={() => onToggle(c.name)}>{c.name}</button>;
                })}
              </div>
            </div>
          ))}
          {!comps.length && <p className="text-(--dim) text-xs">没有匹配的组件。</p>}
        </div>
      </div>
    </div>
  );
}

// ============ 组件编辑器 ============

function ComponentEditor({ view, sel, onSaved, onSelect }: EditorProps) {
  const existing = sel === NEW ? null : view.components.find((c) => c.name === sel) ?? null;
  const advanced = !!existing && existing.fragments.some((f) => Object.keys(f).length > 1);
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [lines, setLines] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setMsg(null);
    if (existing) { setName(existing.name); setGroup(existing.group); setLines(existing.fragments.map((f) => f.text).join('\n')); }
    else { setName(''); setGroup(''); setLines(''); }
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!name.trim()) { setMsg('请填组件名。'); return; }
    const frags = lines.split('\n').map((l) => l.trim()).filter(Boolean).map((text) => ({ text }));
    const res = await api('/api/content-pools/save', { layer: 'component', key: name.trim(), entry: frags, scope: existing?.scope, group });
    if (!res.ok) { setMsg(`保存失败：${res.status}`); return; }
    if (existing && existing.group !== group) await api('/api/content-pools/delete', { layer: 'component', key: name.trim(), scope: existing.scope, group: existing.group });
    setMsg('已保存。'); await onSaved(); onSelect(name.trim());
  }
  async function remove() {
    if (!existing) return;
    const res = await api('/api/content-pools/delete', { layer: 'component', key: existing.name, scope: existing.scope, group: existing.group });
    if (res.ok) { await onSaved(); onSelect(NEW); } else setMsg(`删除失败：${res.status}`);
  }

  return (
    <div className="space-y-3 p-3">
      <div className="flex gap-3 flex-wrap">
        <Field label="组件名"><input className={`${input} w-52`} value={name} onChange={(e) => setName(e.target.value)} placeholder="组件名" disabled={!!existing} /></Field>
        <GroupField value={group} onChange={setGroup} options={groupsOf(view, 'component', existing?.scope ?? 'world')} />
      </div>
      {advanced ? (
        <p className="text-(--amber) text-xs">该组件含高级标签（如说话人/对象派系、立场偏好等），第一口暂不支持在此编辑以免丢标签——待后续补。</p>
      ) : (
        <Field label="候选片段（每行一条，可含 {组件名} 占位符）">
          <textarea className={`${input} w-full h-40 font-mono`} value={lines} onChange={(e) => setLines(e.target.value)} placeholder={'每行一条候选片段'} />
        </Field>
      )}
      <div className="flex items-center gap-2 pt-1">
        {!advanced && <button className={btn} onClick={() => void save()}><i className="ri-save-line" /> 保存</button>}
        {existing && <button className={`${btn} text-(--pink)`} onClick={() => void remove()}><i className="ri-delete-bin-line" /> 删除</button>}
      </div>
      {msg && <p className="text-(--dim) text-xs">{msg}</p>}
    </div>
  );
}
