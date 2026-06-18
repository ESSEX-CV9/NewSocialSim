import { useEffect, useRef, useState } from 'react';
import { DockviewReact, themeAbyss } from 'dockview';
import type { DockviewApi, DockviewReadyEvent } from 'dockview';
import 'dockview/dist/styles/dockview.css';
import { PaneHost } from './panels/PaneHost.js';
import { useActiveWorld } from './hooks/useActiveWorld.js';
import { PRESETS, DEFAULT_PRESET, applyPreset, type Preset } from './layouts/presets.js';

const components = { 'pane-host': PaneHost };
// dockview 主题须用稳定引用——内联新建对象会让每次 re-render（顶栏每 250ms tick）都重设主题、
// 把正在拖拽的窗格尺寸打回去。故 module 级常量、不随渲染变。gap 拉开窗格间距（黑色间隙分隔圆角窗口）。
const DV_THEME = { ...themeAbyss, gap: 6 };

type Layout = ReturnType<DockviewApi['toJSON']>;
/** 当前活动布局 = 一个预设、或一条命名存档。修改即回写到它自己的槽。 */
type Active = { kind: 'preset'; id: string } | { kind: 'saved'; name: string };
interface LayoutsDoc {
  saved: Array<{ name: string; layout: Layout }>;
  last: Layout | null;
  /** 每个预设的自定义版本（按预设 id）：切到该预设时优先用它，使对预设的修改跨切换保留。 */
  presets?: Record<string, Layout>;
  /** 上次活动布局（预设或命名存档）；供恢复默认与重开后续写到正确的槽。 */
  lastActive?: Active | null;
  /** 旧字段，仅用于迁移读取（映射为 lastActive）。 */
  lastPresetId?: string | null;
}
const DEFAULT_ACTIVE: Active = { kind: 'preset', id: DEFAULT_PRESET.id };

function formatTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function App() {
  const apiRef = useRef<DockviewApi | null>(null);
  const docRef = useRef<LayoutsDoc>({ saved: [], last: null });
  const loadedWorldRef = useRef<string>('');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counterRef = useRef(0);
  // 水合门闩：本世界布局加载完成前禁止保存。否则 onReady 立刻铺默认预设触发的初始保存
  // 会抢在 loadLayouts 之前把存档写成 {saved:[], last:默认}，清空用户存的布局并把修改重置回默认。
  const hydratedRef = useRef(false);
  // 当前活动布局（预设或命名存档）：修改即回写到它的槽；切走定格、切回取它存的版本。
  const activeRef = useRef<Active>(DEFAULT_ACTIVE);

  const [apiReady, setApiReady] = useState(false);
  const [savedNames, setSavedNames] = useState<string[]>([]);
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [active, setActiveDisplay] = useState<Active>(DEFAULT_ACTIVE); // 渲染用：状态条「当前布局」+ 下拉回显
  const world = useActiveWorld();
  const backend = window.editor.backendUrl;

  function onReady(event: DockviewReadyEvent): void {
    apiRef.current = event.api;
    // 立即铺默认预设，保证打开不空白；世界解析出来后 loadLayouts 再用该世界存档覆盖。
    applyPreset(event.api, DEFAULT_PRESET);
    event.api.onDidLayoutChange(() => scheduleSave());
    setApiReady(true);
  }

  // 后端可达（apiReady）即加载该世界布局；world.id 变化时重载。**不等 world.id 解析**——
  // 后端 /api/layouts 服务端自解析活动世界，故 hydration 不依赖前端 world.id 的解析时机。
  // 加载失败不开闸、不覆盖，1s 重试。
  useEffect(() => {
    if (!apiReady) return;
    const target = world.id || '__active__'; // world.id 未解析时仍加载活动世界
    if (target === loadedWorldRef.current) return;
    hydratedRef.current = false; // 切世界/初次：先关闸，加载成功后再开
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function attempt(): Promise<void> {
      let ok = false;
      try {
        ok = await loadLayouts();
      } catch (e) {
        console.error('[layouts] load threw', e);
        ok = false;
      }
      if (cancelled) return;
      if (ok) loadedWorldRef.current = target;
      else timer = setTimeout(() => void attempt(), 1000); // 后端/社交站未就绪：1s 后重试
    }
    void attempt();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiReady, world.id]);

  /** 活动布局的人类可读名（状态条显示）。 */
  function labelOf(a: Active): string {
    return a.kind === 'saved' ? `存档·${a.name}` : PRESETS.find((p) => p.id === a.id)?.name ?? a.id;
  }
  /** 设活动布局：写 ref（供保存逻辑）+ 触发渲染（状态条 / 下拉回显）。 */
  function setActive(a: Active): void {
    activeRef.current = a;
    setActiveDisplay(a);
  }

  /** 从 doc 推断活动布局（含旧 lastPresetId 迁移）。 */
  function activeFromDoc(doc: LayoutsDoc): Active {
    const a = doc.lastActive;
    if (a && (a.kind === 'preset' || a.kind === 'saved')) return a;
    if (doc.lastPresetId) return { kind: 'preset', id: doc.lastPresetId };
    return DEFAULT_ACTIVE;
  }

  /** 载入当前世界布局。返回是否成功——**失败时绝不改 docRef / 不开闸 / 不覆盖磁盘**，
   *  否则一次瞬时 GET 失败（如社交站未就绪→后端 502）会让 docRef.saved 变空、随后写盘冲掉存档。 */
  async function loadLayouts(): Promise<boolean> {
    const api = apiRef.current;
    if (!api) return false;
    let doc: LayoutsDoc | null = null;
    try {
      const res = await fetch(`${backend}/api/layouts`);
      if (res.ok) doc = (await res.json()) as LayoutsDoc;
    } catch {
      /* 后端暂不可达 */
    }
    if (!doc) return false; // 加载未成功：保持关闸、不动磁盘，留待重试
    docRef.current = { presets: {}, ...doc, saved: doc.saved ?? [] };
    setSavedNames((doc.saved ?? []).map((s) => s.name));
    setActive(activeFromDoc(doc)); // 恢复上次活动布局上下文（决定后续修改写回哪个槽）
    // 应用布局包 try/catch——**绝不让 apply 异常逃逸**，否则下面开闸那行执行不到、门闩永久卡死，
    // 所有捕获/回写静默空转（#2 的真凶）。fromJSON 半坏后再 applyPreset 也包一层，避免二次抛出。
    let applied = false;
    try {
      if (doc.last) {
        api.fromJSON(doc.last); // 恢复上次该世界的布局（"重启恢复哪个" = 恢复 last）
        applied = true;
      }
    } catch {
      /* 损坏的布局，退回默认预设 */
    }
    if (!applied) {
      try {
        applyPreset(api, DEFAULT_PRESET); // applyPreset 内部先 api.clear() 重置，再退回原始布局
      } catch {
        /* applyPreset 也失败也不阻断开闸 */
      }
    }
    // **GET 成功即视为已加载、开闸存盘**——与 apply 是否成功解耦，门闩必翻、不可能卡死。
    hydratedRef.current = true;
    return true;
  }

  /** 发一次 JSON 写请求；失败返回 null（落盘失败不影响当前会话）。 */
  async function apiSend(method: string, path: string, body: unknown): Promise<Response | null> {
    try {
      return await fetch(`${backend}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      return null;
    }
  }

  /** 从后端拉 doc 并**合并**进本地缓存（保留本会话刚写的 presets/saved 不被覆盖），供切换时本地缺失自愈。 */
  async function refreshDoc(): Promise<LayoutsDoc | null> {
    try {
      const res = await fetch(`${backend}/api/layouts`);
      if (!res.ok) return null;
      const doc = (await res.json()) as LayoutsDoc;
      const byName = new Map<string, { name: string; layout: Layout }>();
      for (const s of doc.saved ?? []) byName.set(s.name, s);
      for (const s of docRef.current.saved) byName.set(s.name, s); // 本地（含刚改的）优先
      docRef.current = {
        saved: [...byName.values()],
        last: docRef.current.last ?? doc.last ?? null,
        presets: { ...doc.presets, ...docRef.current.presets }, // 本地 in-flight 捕获优先
        lastActive: docRef.current.lastActive ?? doc.lastActive ?? null,
      };
      setSavedNames(docRef.current.saved.map((s) => s.name));
      if (!hydratedRef.current) setActive(activeFromDoc(doc));
      return docRef.current;
    } catch {
      return null;
    }
  }

  /** 当前活动布局存的版本：预设取 presets[id]、存档取 saved[name].layout。 */
  function storedLayoutFor(a: Active): Layout | undefined {
    return a.kind === 'preset'
      ? docRef.current.presets?.[a.id]
      : docRef.current.saved.find((s) => s.name === a.name)?.layout;
  }

  /** 立即把 last + 活动布局描述落盘（供重开恢复到正确布局与槽）。加载前不写，免开机默认盖掉真实 last。 */
  function persistLast(layout: Layout): void {
    if (!hydratedRef.current) return;
    void apiSend('PUT', '/api/layouts/last', { last: layout, lastActive: activeRef.current });
  }

  /** 把当前布局回写到**活动槽**（预设→presets[id]，存档→saved[name]）——这是 #2 的核心：
   *  不管当前是预设还是命名存档，修改都落回它自己，切走再回来就是改后的。 */
  function captureActive(layout?: Layout): void {
    const api = apiRef.current;
    if (!api || !hydratedRef.current) return;
    const l = layout ?? api.toJSON();
    const a = activeRef.current;
    if (a.kind === 'preset') {
      docRef.current.presets = { ...docRef.current.presets, [a.id]: l };
      void apiSend('PUT', '/api/layouts/preset', { id: a.id, layout: l });
    } else {
      docRef.current.saved = [...docRef.current.saved.filter((s) => s.name !== a.name), { name: a.name, layout: l }];
      setSavedNames(docRef.current.saved.map((s) => s.name));
      void apiSend('PUT', '/api/layouts/saved', { name: a.name, layout: l });
    }
  }

  // 拖拽/缩放/增删面板的防抖自动保存：回写活动槽 + last。加载前门闩拦住。
  function scheduleSave(): void {
    if (!hydratedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const api = apiRef.current;
      if (!api) return;
      const layout = api.toJSON();
      captureActive(layout);
      persistLast(layout);
    }, 700);
  }

  /** 切到目标活动布局：先定格离开的，再取目标存的版本应用（预设无存版则用原始）。 */
  async function switchTo(target: Active, presetForPristine?: Preset): Promise<void> {
    const api = apiRef.current;
    if (!api) return;
    captureActive(); // 定格离开的活动布局到它自己的槽
    setActive(target);
    let layout = storedLayoutFor(target);
    if (!layout) {
      const d = await refreshDoc(); // 本地没有：从后端自愈一次
      if (d) layout = storedLayoutFor(target);
    }
    if (layout) {
      try {
        api.fromJSON(layout);
        persistLast(layout);
        return;
      } catch {
        /* 损坏则退回原始 */
      }
    }
    if (target.kind === 'preset') {
      const p = presetForPristine ?? PRESETS.find((x) => x.id === target.id) ?? DEFAULT_PRESET;
      applyPreset(api, p);
      persistLast(api.toJSON());
    }
  }

  function selectPreset(preset: Preset): Promise<void> {
    return switchTo({ kind: 'preset', id: preset.id }, preset);
  }
  function applySaved(name: string): Promise<void> {
    return switchTo({ kind: 'saved', name });
  }

  /** 恢复默认：把当前预设重置回原始布局（活动是存档时回到默认预设），并立即覆盖其自定义版本。 */
  function restoreDefault(): void {
    const api = apiRef.current;
    if (!api) return;
    const a = activeRef.current;
    const preset = (a.kind === 'preset' ? PRESETS.find((p) => p.id === a.id) : null) ?? DEFAULT_PRESET;
    setActive({ kind: 'preset', id: preset.id });
    applyPreset(api, preset); // 同步构建原始布局
    const layout = api.toJSON();
    docRef.current.presets = { ...docRef.current.presets, [preset.id]: layout };
    void apiSend('PUT', '/api/layouts/preset', { id: preset.id, layout });
    persistLast(layout);
  }

  // 保存命名布局：合并写一条，并以它为当前活动布局（之后的修改回写到它）。
  function saveCurrent(): void {
    const api = apiRef.current;
    const name = saveName.trim() || '我的布局';
    if (!api) return;
    const layout = api.toJSON();
    docRef.current.saved = [...docRef.current.saved.filter((s) => s.name !== name), { name, layout }];
    setSavedNames(docRef.current.saved.map((s) => s.name)); // 乐观更新
    setActive({ kind: 'saved', name });
    void (async () => {
      const res = await apiSend('PUT', '/api/layouts/saved', { name, layout });
      if (res?.ok) {
        const j = (await res.json()) as { saved?: string[] };
        if (j.saved) setSavedNames(j.saved); // 以后端权威名单为准
      }
    })();
    persistLast(layout);
    setShowSave(false);
    setSaveName('');
  }

  function deleteSaved(name: string): void {
    docRef.current.saved = docRef.current.saved.filter((s) => s.name !== name);
    setSavedNames(docRef.current.saved.map((s) => s.name));
    if (activeRef.current.kind === 'saved' && activeRef.current.name === name) setActive(DEFAULT_ACTIVE);
    void (async () => {
      const res = await apiSend('DELETE', '/api/layouts/saved', { name });
      if (res?.ok) {
        const j = (await res.json()) as { saved?: string[] };
        if (j.saved) setSavedNames(j.saved);
      }
    })();
  }

  function newPane(): void {
    const api = apiRef.current;
    if (!api) return;
    counterRef.current += 1;
    api.addPanel({
      id: `pane-new-${counterRef.current}`,
      component: 'pane-host',
      title: '控制台',
      params: { panelType: 'console' },
    });
  }

  const presetBtn = 'text-xs px-2 py-1 rounded-lg bg-(--chip) border border-(--border) hover:bg-[#2a2e33]';

  return (
    <div className="h-screen flex flex-col bg-(--bg) text-(--text)">
      {/* 顶栏 */}
      <header className="flex items-center gap-3 px-3 h-12 shrink-0 bg-(--panel) border-b border-(--border)">
        <span className="font-bold">
          NewSocialSim <span className="text-(--blue)">Studio</span>
        </span>
        {world.connected && (
          <div className="flex items-center gap-2 bg-(--chip) border border-(--border) rounded-lg px-2.5 py-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: world.paused ? 'var(--amber)' : 'var(--green)' }} />
            <b className="text-xs">{world.id}</b>
            <span className="text-(--dim) text-xs">{world.name}</span>
          </div>
        )}
        {world.connected && (
          <div className="text-(--dim) text-xs tabular-nums">
            <i className="ri-time-line" /> <b className="text-(--text)">{formatTime(world.currentSimMs)}</b> ×{world.scale}
          </div>
        )}

        <div className="flex-1" />

        {/* 预设布局 */}
        <div className="flex items-center gap-1">
          {PRESETS.map((p) => (
            <button key={p.id} className={presetBtn} onClick={() => void selectPreset(p)} title={`预设：${p.name}`}>
              {p.name}
            </button>
          ))}
          <button
            className={presetBtn}
            onClick={restoreDefault}
            title="恢复当前预设的默认布局（丢弃对它的修改）"
          >
            <i className="ri-refresh-line" /> 恢复默认
          </button>
        </div>

        {/* 已存布局：选中后回显当前布局名（活动是命名存档时显示其名，否则显示占位） */}
        {savedNames.length > 0 && (
          <select
            className="text-xs bg-(--chip) border border-(--border) rounded-lg px-2 py-1 text-(--text) outline-none cursor-pointer"
            value={active.kind === 'saved' ? active.name : ''}
            onChange={(e) => {
              if (e.target.value) void applySaved(e.target.value);
            }}
          >
            <option value="">已存布局…</option>
            {savedNames.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        )}

        {/* 保存布局（内联输入，不用原生弹窗） */}
        {showSave ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveCurrent();
                if (e.key === 'Escape') setShowSave(false);
              }}
              placeholder="布局名"
              className="text-xs bg-(--panel2) border border-(--border) rounded-lg px-2 py-1 text-(--text) outline-none w-24"
            />
            <button className={presetBtn} onClick={saveCurrent}>确定</button>
            {saveName.trim() && savedNames.includes(saveName.trim()) && (
              <button className={presetBtn} onClick={() => deleteSaved(saveName.trim())} title="删除同名布局">
                <i className="ri-delete-bin-line" />
              </button>
            )}
          </div>
        ) : (
          <button className={presetBtn} onClick={() => setShowSave(true)}>
            <i className="ri-save-line" /> 保存布局
          </button>
        )}

        <button onClick={newPane} className={presetBtn}>
          <i className="ri-add-line" /> 新建格
        </button>
        <button className="w-7 h-7 rounded-lg bg-(--chip) border border-(--border) text-(--dim)" title="设置">
          <i className="ri-settings-3-line" />
        </button>
      </header>

      {/* 工作区 */}
      <div className="flex-1 min-h-0 relative">
        <DockviewReact components={components} onReady={onReady} theme={DV_THEME} />
      </div>

      {/* 底部状态条 */}
      <footer className="flex items-center gap-4 px-3 h-6 shrink-0 bg-(--panel) border-t border-(--border) text-[11px] text-(--dim)">
        {world.connected ? (
          <>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: world.paused ? 'var(--amber)' : 'var(--green)' }} />
              {world.paused ? '已暂停' : '运行中'}
            </span>
            <span>世界 {world.id} · ×{world.scale}</span>
          </>
        ) : (
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--amber)' }} />
            编辑器后端未连接
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <i className="ri-layout-grid-line" />
          当前布局：<b className="text-(--text)">{labelOf(active)}</b>
        </span>
      </footer>
    </div>
  );
}
