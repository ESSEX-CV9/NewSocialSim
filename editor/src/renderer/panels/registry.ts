import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { WorldStatusPanel } from './WorldStatusPanel.js';
import { PlaceholderPanel } from './PlaceholderPanel.js';

/**
 * 面板注册表：editor 每个里程碑长出的面板都登记在此。
 * id 同时作为 dockview 组件键；title 为标签页标题。后续面板只往 PANELS 里加一项，
 * 不另起页面路由。
 */
export interface PanelDef {
  id: string;
  title: string;
  component: FunctionComponent<IDockviewPanelProps>;
}

export const PANELS: PanelDef[] = [
  { id: 'world-status', title: '世界状态', component: WorldStatusPanel },
  { id: 'placeholder', title: '占位面板', component: PlaceholderPanel },
];

/** dockview 的 components 映射：组件键 -> 面板组件。 */
export const panelComponents: Record<string, FunctionComponent<IDockviewPanelProps>> =
  Object.fromEntries(PANELS.map((p) => [p.id, p.component]));
