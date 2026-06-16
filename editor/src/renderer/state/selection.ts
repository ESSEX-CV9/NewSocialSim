import { useSyncExternalStore } from 'react';
import type { StoredSimTraceEvent } from '@socialsim/shared';

/**
 * 跨面板选中态：时间轴点选一个轨迹事件，检视器面板订阅展示其详情。
 * 面板各自独立挂载，用一个模块级 pub/sub 单例做共享态，避免跨 dockview 面板传 props。
 */

let selected: StoredSimTraceEvent | null = null;
const listeners = new Set<() => void>();

/** 设置（或清空）当前选中的轨迹事件，通知所有订阅面板。 */
export function setSelectedTrace(e: StoredSimTraceEvent | null): void {
  selected = e;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): StoredSimTraceEvent | null {
  return selected;
}

/** 订阅当前选中的轨迹事件（null 表示未选）。 */
export function useSelectedTrace(): StoredSimTraceEvent | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}
