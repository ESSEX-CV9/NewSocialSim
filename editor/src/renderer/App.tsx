import { useRef } from 'react';
import { DockviewReact, themeAbyss } from 'dockview';
import type { DockviewApi, DockviewReadyEvent } from 'dockview';
import 'dockview/dist/styles/dockview.css';
import { PaneHost } from './panels/PaneHost.js';
import { useActiveWorld } from './hooks/useActiveWorld.js';

const components = { 'pane-host': PaneHost };

function formatTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function App() {
  const apiRef = useRef<DockviewApi | null>(null);
  const counterRef = useRef(2);
  const world = useActiveWorld();

  function onReady(event: DockviewReadyEvent): void {
    apiRef.current = event.api;
    const c = event.api.addPanel({
      id: 'pane-1',
      component: 'pane-host',
      title: '控制台',
      params: { panelType: 'console' },
    });
    event.api.addPanel({
      id: 'pane-2',
      component: 'pane-host',
      title: '时间轴',
      params: { panelType: 'timeline' },
      position: { referencePanel: c.id, direction: 'right' },
    });
  }

  function newPane(): void {
    const api = apiRef.current;
    if (!api) return;
    counterRef.current += 1;
    api.addPanel({
      id: `pane-${counterRef.current}`,
      component: 'pane-host',
      title: '控制台',
      params: { panelType: 'console' },
    });
  }

  return (
    <div className="h-screen flex flex-col bg-(--bg) text-(--text)">
      {/* 顶栏 */}
      <header className="flex items-center gap-3 px-3 h-12 shrink-0 bg-(--panel) border-b border-(--border)">
        <span className="font-bold">
          NewSocialSim <span className="text-(--blue)">Studio</span>
        </span>
        {world.connected && (
          <div className="flex items-center gap-2 bg-(--chip) border border-(--border) rounded-lg px-2.5 py-1">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: world.paused ? 'var(--amber)' : 'var(--green)' }}
            />
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
        <button
          onClick={newPane}
          className="text-xs px-3 py-1.5 rounded-lg bg-(--chip) border border-(--border) hover:bg-[#2a2e33]"
        >
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
