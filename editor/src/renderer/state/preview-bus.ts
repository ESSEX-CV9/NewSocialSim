import { useSyncExternalStore } from 'react';
import type { PoolPreviewResponse, PoolPreviewSample } from '@socialsim/shared';

/**
 * 跨面板内容池预览总线：内容池面板点「预览」时随机模拟一条并把结果发布到此；
 * 独立的预览器面板订阅、按槽位可视化展示。同 selection.ts 范式（模块级 pub/sub 单例）。
 */

export interface PreviewState {
  sample: PoolPreviewSample | null;
  msg: string | null;
  loading: boolean;
}

let state: PreviewState = { sample: null, msg: null, loading: false };
let lastReq: { pool: unknown; grammars?: Record<string, unknown> } | null = null;
const listeners = new Set<() => void>();

function set(s: PreviewState): void {
  state = s;
  for (const l of listeners) l();
}

/** 随机模拟一条（经模拟器活引擎），结果发布到总线供预览器面板展示。 */
export async function runPreview(pool: unknown, grammars?: Record<string, unknown>): Promise<void> {
  lastReq = grammars ? { pool, grammars } : { pool };
  set({ sample: null, msg: null, loading: true });
  const body: Record<string, unknown> = { pool, count: 1 };
  if (grammars) body.grammars = grammars;
  try {
    const res = await fetch(`${window.editor.backendUrl}/api/content-pools/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 503) { set({ sample: null, msg: '模拟器未运行，启动后可预览。', loading: false }); return; }
    const data = (await res.json()) as PoolPreviewResponse;
    const s = data.samples?.[0];
    if (!s) set({ sample: null, msg: `没组装出内容（失败 ${data.failed ?? 0} 次）——检查语法/组件是否齐全。`, loading: false });
    else set({ sample: s, msg: null, loading: false });
  } catch (e) {
    set({ sample: null, msg: String(e), loading: false });
  }
}

/** 用上次的请求再随机模拟一条（预览器「再来一个」）。 */
export function reroll(): void {
  if (lastReq) void runPreview(lastReq.pool, lastReq.grammars);
}

export function usePreview(): PreviewState {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => state,
  );
}
