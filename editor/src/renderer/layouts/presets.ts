import type { DockviewApi } from 'dockview';
import { panelById } from '../panels/registry.js';

/** 推荐布局：一组面板类型，从左到右铺成并列窗格。面板未实现的先用占位组件呈现。 */
export interface Preset {
  id: string;
  name: string;
  panes: string[];
}

export const PRESETS: Preset[] = [
  { id: 'observe', name: '观察', panes: ['console', 'timeline', 'inspector'] },
  { id: 'npc', name: 'NPC 建设', panes: ['npc', 'inspector'] },
  { id: 'pools', name: '内容池', panes: ['pools', 'inspector'] },
  { id: 'lore', name: '设定', panes: ['lore', 'inspector'] },
];

export const DEFAULT_PRESET = PRESETS[0]!;

/** 清空并按面板类型从左到右铺设窗格。 */
export function applyPanes(api: DockviewApi, panes: string[]): void {
  api.clear();
  let prevId: string | undefined;
  panes.forEach((type, i) => {
    const def = panelById[type];
    const panel = api.addPanel({
      id: `pane-${i + 1}`,
      component: 'pane-host',
      title: def?.title ?? type,
      params: { panelType: type },
      ...(prevId ? { position: { referencePanel: prevId, direction: 'right' as const } } : {}),
    });
    prevId = panel.id;
  });
}
