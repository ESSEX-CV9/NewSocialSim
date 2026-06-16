import type { DockviewApi } from 'dockview';
import { panelById } from '../panels/registry.js';

/**
 * 推荐布局：默认以面板类型从左到右铺并列窗格；个别预设可给 build 自定义二维布局。
 * 面板未实现的先用占位组件呈现。
 */
export interface Preset {
  id: string;
  name: string;
  panes: string[];
  /** 自定义布局构建器（覆盖默认的横排 panes）。 */
  build?: (api: DockviewApi) => void;
}

export const PRESETS: Preset[] = [
  // 观察：控制台顶部通栏；下方时间轴(宽) | 检视器(窄)并排。
  { id: 'observe', name: '观察', panes: ['console', 'timeline', 'inspector'], build: buildObserve },
  { id: 'npc', name: 'NPC 建设', panes: ['npc', 'inspector'] },
  { id: 'pools', name: '内容池', panes: ['pools', 'inspector'] },
  { id: 'lore', name: '设定', panes: ['lore', 'inspector'] },
];

export const DEFAULT_PRESET = PRESETS[0]!;

/** 应用一个预设：有 build 用 build，否则横排 panes。 */
export function applyPreset(api: DockviewApi, preset: Preset): void {
  if (preset.build) {
    api.clear();
    preset.build(api);
  } else {
    applyPanes(api, preset.panes);
  }
}

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

/** 观察布局：控制台顶部通栏；下方 时间轴(宽) | 检视器(窄) 并排。 */
function buildObserve(api: DockviewApi): void {
  const base = (id: string, type: string) => ({
    id,
    component: 'pane-host',
    title: panelById[type]?.title ?? type,
    params: { panelType: type },
  });

  api.addPanel(base('pane-1', 'console'));
  // 时间轴在控制台正下方，撑满底部整行。
  const timeline = api.addPanel({ ...base('pane-2', 'timeline'), position: { referencePanel: 'pane-1', direction: 'below' } });
  // 检视器贴在时间轴右侧，较窄。
  const inspector = api.addPanel({ ...base('pane-3', 'inspector'), position: { referencePanel: timeline.id, direction: 'right' } });
  try {
    api.getPanel('pane-1')?.api.setSize({ height: 240 }); // 控制台顶部偏矮
    inspector.api.setSize({ width: 300 }); // 检视器窄栏
  } catch {
    /* 容器尺寸未就绪时忽略，用默认比例 */
  }
}
