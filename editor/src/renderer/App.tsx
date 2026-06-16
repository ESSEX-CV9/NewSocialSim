import { useRef, useState } from 'react';
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
  const [assistantOpen, setAssistantOpen] = useState(false);
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
    <div className="h-screen flex flex-col bg-[var(--bg)] text-[var(--text)]">
      {/* 顶栏 */}
      <header className="flex items-center gap-3 px-3 h-12 shrink-0 bg-[var(--panel)] border-b border-[var(--border)]">
        <span className="font-bold">
          NewSocialSim <span className="text-[var(--blue)]">Studio</span>
        </span>
        {world.connected && (
          <div className="flex items-center gap-2 bg-[var(--chip)] border border-[var(--border)] rounded-lg px-2.5 py-1">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: world.paused ? 'var(--amber)' : 'var(--green)' }}
            />
            <b className="text-xs">{world.id}</b>
            <span className="text-[var(--dim)] text-xs">{world.name}</span>
          </div>
        )}
        {world.connected && (
          <div className="text-[var(--dim)] text-xs tabular-nums">
            <i className="ri-time-line" /> <b className="text-[var(--text)]">{formatTime(world.currentSimMs)}</b> ×{world.scale}
          </div>
        )}
        <div className="flex-1" />
        <button
          onClick={newPane}
          className="text-xs px-3 py-1.5 rounded-lg bg-[var(--chip)] border border-[var(--border)] hover:bg-[#2a2e33]"
        >
          <i className="ri-add-line" /> 新建格
        </button>
        <button className="w-7 h-7 rounded-lg bg-[var(--chip)] border border-[var(--border)] text-[var(--dim)]" title="设置">
          <i className="ri-settings-3-line" />
        </button>
      </header>

      {/* 工作区 */}
      <div className="flex-1 min-h-0 relative">
        <DockviewReact components={components} onReady={onReady} theme={themeAbyss} />
      </div>

      {/* 底部状态条 */}
      <footer className="flex items-center gap-4 px-3 h-6 shrink-0 bg-[var(--panel)] border-t border-[var(--border)] text-[11px] text-[var(--dim)]">
        {world.connected ? (
          <>
            <span style={{ color: world.paused ? 'var(--amber)' : 'var(--green)' }}>
              ● {world.paused ? '已暂停' : '运行中'}
            </span>
            <span>世界 {world.id} · ×{world.scale}</span>
          </>
        ) : (
          <span style={{ color: 'var(--amber)' }}>● 编辑器后端未连接</span>
        )}
        <span className="ml-auto">静态阶段 · 模拟器状态/轨迹流将于后续接入</span>
      </footer>

      {/* 创作助手悬浮球 + 悬浮窗 */}
      {assistantOpen && (
        <div className="fixed right-5 bottom-24 h-[460px] bg-[var(--panel)] border border-[var(--border)] rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden" style={{ width: 360 }}>
          <div className="flex items-center gap-2 px-3.5 py-3 border-b border-[var(--border)]">
            <i className="ri-chat-smile-2-line text-[var(--blue)]" />
            <span className="font-bold">创作助手</span>
            <i
              className="ri-subtract-line ml-auto cursor-pointer text-[var(--dim)] text-lg"
              onClick={() => setAssistantOpen(false)}
            />
          </div>
          <div className="flex-1 p-3.5 overflow-auto">
            <div className="max-w-[78%] px-3 py-2 rounded-2xl bg-[var(--chip)] border border-[var(--border)] text-[13px]">
              用大白话告诉我你想怎么建设世界——建号、设关注关系、预填帖子、造话题。
            </div>
          </div>
          <div className="flex gap-2 p-3 border-t border-[var(--border)]">
            <input
              className="flex-1 bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-[var(--text)] outline-none"
              placeholder="说点什么…"
            />
            <button className="px-3 rounded-xl bg-[var(--blue)] text-white">
              <i className="ri-send-plane-line" />
            </button>
          </div>
        </div>
      )}
      <button
        onClick={() => setAssistantOpen((v) => !v)}
        className="fixed right-5 bottom-10 rounded-full bg-[var(--blue)] text-white text-2xl flex items-center justify-center shadow-lg z-50"
        style={{ width: 52, height: 52 }}
        title="创作助手"
      >
        <i className="ri-chat-smile-2-line" />
      </button>
    </div>
  );
}
