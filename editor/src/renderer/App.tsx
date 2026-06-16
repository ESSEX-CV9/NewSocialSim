import { useRef } from 'react';
import { DockviewReact, themeAbyss } from 'dockview';
import type { DockviewApi, DockviewReadyEvent } from 'dockview';
import 'dockview/dist/styles/dockview.css';
import { PANELS, panelComponents, type PanelDef } from './panels/registry.js';

export function App() {
  const apiRef = useRef<DockviewApi | null>(null);
  const counterRef = useRef(0);

  function onReady(event: DockviewReadyEvent): void {
    apiRef.current = event.api;
    // 初始布局：左控制台 + 右占位，演示同屏并列与可拖拽分割。
    const console_ = event.api.addPanel({ id: 'console', component: 'console', title: '控制台' });
    event.api.addPanel({
      id: 'placeholder-0',
      component: 'placeholder',
      title: '占位面板',
      position: { referencePanel: console_.id, direction: 'right' },
    });
  }

  function addPanel(def: PanelDef): void {
    const api = apiRef.current;
    if (!api) return;
    counterRef.current += 1;
    api.addPanel({ id: `${def.id}-${counterRef.current}`, component: def.id, title: def.title });
  }

  return (
    <div className="h-screen flex flex-col">
      <header className="flex items-center gap-3 px-4 py-2 border-b border-gray-800 shrink-0">
        <h1 className="text-base font-bold">SocialSim Studio</h1>
        <span className="text-xs text-gray-500">editor backend: {window.editor.backendUrl}</span>
        <div className="ml-auto flex gap-1">
          {PANELS.map((def) => (
            <button
              key={def.id}
              onClick={() => addPanel(def)}
              className="px-2 py-1 text-xs rounded bg-gray-800 text-gray-300 hover:bg-gray-700"
            >
              + {def.title}
            </button>
          ))}
        </div>
      </header>
      <div className="flex-1 min-h-0 relative">
        <DockviewReact components={panelComponents} onReady={onReady} theme={themeAbyss} />
      </div>
    </div>
  );
}
