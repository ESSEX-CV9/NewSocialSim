import { useEffect, useRef, useState } from 'react';
import { DockviewReact, themeAbyss } from 'dockview';
import type { DockviewApi, DockviewReadyEvent } from 'dockview';
import 'dockview/dist/styles/dockview.css';
import { PaneHost } from './panels/PaneHost.js';
import { useActiveWorld } from './hooks/useActiveWorld.js';
import { PRESETS, DEFAULT_PRESET, applyPreset, type Preset } from './layouts/presets.js';

const components = { 'pane-host': PaneHost };

type Layout = ReturnType<DockviewApi['toJSON']>;
interface LayoutsDoc {
  saved: Array<{ name: string; layout: Layout }>;
  last: Layout | null;
}

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

  const [apiReady, setApiReady] = useState(false);
  const [savedNames, setSavedNames] = useState<string[]>([]);
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState('');
  const world = useActiveWorld();
  const backend = window.editor.backendUrl;

  function onReady(event: DockviewReadyEvent): void {
    apiRef.current = event.api;
    // 立即铺默认预设，保证打开不空白；世界解析出来后 loadLayouts 再用该世界存档覆盖。
    applyPreset(event.api, DEFAULT_PRESET);
    event.api.onDidLayoutChange(() => scheduleSave());
    setApiReady(true);
  }

  // 活动世界就绪/变化时，载入该世界的布局（跟随世界）。
  useEffect(() => {
    if (!apiReady || !world.id) return;
    if (world.id === loadedWorldRef.current) return;
    loadedWorldRef.current = world.id;
    void loadLayouts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiReady, world.id]);

  async function loadLayouts(): Promise<void> {
    const api = apiRef.current;
    if (!api) return;
    let doc: LayoutsDoc = { saved: [], last: null };
    try {
      const res = await fetch(`${backend}/api/layouts`);
      if (res.ok) doc = (await res.json()) as LayoutsDoc;
    } catch {
      /* 后端不可达，用空布局 */
    }
    docRef.current = doc;
    setSavedNames(doc.saved.map((s) => s.name));
    if (doc.last) {
      try {
        api.fromJSON(doc.last);
        return;
      } catch {
        /* 损坏的布局，退回默认预设 */
      }
    }
    applyPreset(api, DEFAULT_PRESET);
  }

  function scheduleSave(): void {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const api = apiRef.current;
      if (!api) return;
      void putLayouts({ saved: docRef.current.saved, last: api.toJSON() });
    }, 700);
  }

  async function putLayouts(doc: LayoutsDoc): Promise<void> {
    docRef.current = doc;
    setSavedNames(doc.saved.map((s) => s.name));
    try {
      await fetch(`${backend}/api/layouts`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc),
      });
    } catch {
      /* 落盘失败不影响当前会话 */
    }
  }

  function selectPreset(preset: Preset): void {
    const api = apiRef.current;
    if (api) applyPreset(api, preset);
  }

  function applySaved(name: string): void {
    const api = apiRef.current;
    const s = docRef.current.saved.find((x) => x.name === name);
    if (api && s) {
      try {
        api.fromJSON(s.layout);
      } catch {
        /* ignore */
      }
    }
  }

  function saveCurrent(): void {
    const api = apiRef.current;
    const name = saveName.trim() || '我的布局';
    if (!api) return;
    const layout = api.toJSON();
    const saved = [...docRef.current.saved.filter((s) => s.name !== name), { name, layout }];
    void putLayouts({ saved, last: layout });
    setShowSave(false);
    setSaveName('');
  }

  function deleteSaved(name: string): void {
    const saved = docRef.current.saved.filter((s) => s.name !== name);
    void putLayouts({ saved, last: docRef.current.last });
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
            <button key={p.id} className={presetBtn} onClick={() => selectPreset(p)} title={`预设：${p.name}`}>
              {p.name}
            </button>
          ))}
        </div>

        {/* 已存布局 */}
        {savedNames.length > 0 && (
          <select
            className="text-xs bg-(--chip) border border-(--border) rounded-lg px-2 py-1 text-(--text) outline-none cursor-pointer"
            value=""
            onChange={(e) => {
              if (e.target.value) applySaved(e.target.value);
              e.currentTarget.selectedIndex = 0;
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
        <DockviewReact components={components} onReady={onReady} theme={themeAbyss} />
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
      </footer>
    </div>
  );
}
