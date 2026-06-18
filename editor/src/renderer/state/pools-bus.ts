import { useSyncExternalStore } from 'react';
import type { Fragment, GrammarSlot, PoolGrammarRef } from '@socialsim/shared';

/**
 * 内容池数据的跨面板共享存储：多个内容池面板（如左语法 + 右上组件）订阅同一份数据，
 * 任何一处保存/删除后调 reloadPools()，所有面板与其弹窗即时一致——修跨面板改了分组、
 * 另一面板的选组件弹窗不刷新的问题。同 preview-bus / selection 范式（模块级 pub/sub）。
 */

export type Scope = 'global' | 'world';
export interface ComponentEntry { name: string; fragments: Fragment[]; scope: Scope; group: string }
export interface GrammarEntry { name: string; slots: GrammarSlot[]; scope: Scope; group: string }
export interface PoolEntry {
  id: string;
  dimensions: Record<string, string>;
  tiers?: string[];
  grammars: PoolGrammarRef[];
  fragments?: Record<string, Fragment[]>;
  scope: Scope;
  group: string;
}
export interface PoolsView { components: ComponentEntry[]; grammars: GrammarEntry[]; pools: PoolEntry[] }

let snapshot: { view: PoolsView | null; error: string | null } = { view: null, error: null };
const listeners = new Set<() => void>();

function set(view: PoolsView | null, error: string | null): void {
  snapshot = { view, error };
  for (const l of listeners) l();
}

/** 重新拉取内容池三层并通知所有订阅面板。出错时保留已有数据，仅记错误。 */
export async function reloadPools(): Promise<void> {
  try {
    const res = await fetch(`${window.editor.backendUrl}/api/content-pools`);
    if (!res.ok) throw new Error(`backend ${res.status}`);
    set((await res.json()) as PoolsView, null);
  } catch (e) {
    set(snapshot.view, String(e));
  }
}

export function usePoolsView(): { view: PoolsView | null; error: string | null } {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => snapshot,
  );
}
