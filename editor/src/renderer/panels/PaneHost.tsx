import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { PANELS, panelById } from './registry.js';

/**
 * Blender 式区域容器：每个 dockview 格都是一个 PaneHost。
 * 顶部一条头：左侧下拉切换本格显示哪种面板（取自面板注册表），下方渲染所选面板。
 * 换下拉即换本格内容；dockview 标签同步显示当前面板名。
 */
export function PaneHost(props: IDockviewPanelProps<{ panelType?: string }>) {
  const current = props.params.panelType ?? 'console';
  const def = panelById[current] ?? PANELS[0]!;
  const Body = def.component as FunctionComponent<IDockviewPanelProps>;

  function change(id: string): void {
    const d = panelById[id];
    if (!d) return;
    props.api.updateParameters({ panelType: id });
    props.api.setTitle(d.title);
  }

  return (
    <div className="flex flex-col h-full bg-(--panel) text-(--text)">
      <div className="flex items-center gap-2 px-2 h-7 shrink-0 border-b border-(--border) bg-(--panel2)">
        <i className="ri-apps-2-line text-(--dim) text-sm" />
        <select
          value={current}
          onChange={(e) => change(e.target.value)}
          className="bg-(--chip) border border-(--border) rounded text-xs text-(--text) px-1.5 py-0.5 outline-none cursor-pointer"
        >
          {PANELS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <Body {...props} />
      </div>
    </div>
  );
}
