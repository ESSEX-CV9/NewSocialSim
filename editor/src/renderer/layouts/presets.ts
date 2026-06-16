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
  // 观察：倒品字形——上排控制台 + 检视器并列，下方时间轴铺满整行长方形。
  { id: 'observe', name: '观察', panes: ['console', 'inspector', 'timeline'], build: buildObserve },
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

/** 倒品字形：上排 控制台 | 检视器，下方时间轴铺满整行。 */
function buildObserve(api: DockviewApi): void {
  const base = (id: string, type: string) => ({
    id,
    component: 'pane-host',
    title: panelById[type]?.title ?? type,
    params: { panelType: type },
  });

  api.addPanel(base('pane-1', 'console'));
  api.addPanel({ ...base('pane-2', 'inspector'), position: { referencePanel: 'pane-1', direction: 'right' } });
  // 无 reference + below = 相对整个网格底部，铺满整行。
  const timeline = api.addPanel({ ...base('pane-3', 'timeline'), position: { direction: 'below' } });
  // 给下方时间轴一个偏矮的初始高度，呈横长方形；失败不影响布局。
  try {
    timeline.api.setSize({ height: 300 });
  } catch {
    /* 容器尺寸未就绪时忽略，用默认比例 */
  }
}
