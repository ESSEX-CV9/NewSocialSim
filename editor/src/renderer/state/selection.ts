import { useSyncExternalStore } from 'react';
import type { TimelineBlock } from '../panels/timeline-model.js';

/**
 * 跨面板选中态：时间轴点选一个块（帖子或互动），检视器面板订阅展示其详情。
 * 面板各自独立挂载，用模块级 pub/sub 单例做共享态，避免跨 dockview 面板传 props。
 */

let selected: TimelineBlock | null = null;
const listeners = new Set<() => void>();

/** 设置（或清空）当前选中的块，通知所有订阅面板。 */
export function setSelectedBlock(b: TimelineBlock | null): void {
  selected = b;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): TimelineBlock | null {
  return selected;
}

/** 订阅当前选中的块（null 表示未选）。 */
export function useSelectedBlock(): TimelineBlock | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}
