import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { ConsolePanel } from './ConsolePanel.js';
import { PlaceholderPanel } from './PlaceholderPanel.js';

/**
 * 面板注册表：editor 每个里程碑长出的面板都登记在此。
 * id 为面板类型键（PaneHost 下拉的取值）；title 为下拉/标签显示名。
 * 后续面板只把对应项的 component 从占位换成实现，不另起页面路由。
 */
export interface PanelDef {
  id: string;
  title: string;
  component: FunctionComponent<IDockviewPanelProps>;
}

export const PANELS: PanelDef[] = [
  { id: 'console', title: '控制台', component: ConsolePanel },
  { id: 'timeline', title: '时间轴', component: PlaceholderPanel },
  { id: 'inspector', title: '检视器', component: PlaceholderPanel },
  { id: 'npc', title: 'NPC 设计器', component: PlaceholderPanel },
  { id: 'pools', title: '内容池', component: PlaceholderPanel },
  { id: 'lore', title: '设定文档', component: PlaceholderPanel },
  { id: 'graph', title: '社交图谱', component: PlaceholderPanel },
  { id: 'topics', title: '话题', component: PlaceholderPanel },
  { id: 'stats', title: '数据统计', component: PlaceholderPanel },
  { id: 'media', title: '媒体库', component: PlaceholderPanel },
  { id: 'llm', title: 'LLM 面板', component: PlaceholderPanel },
];

export const panelById: Record<string, PanelDef> = Object.fromEntries(PANELS.map((p) => [p.id, p]));
