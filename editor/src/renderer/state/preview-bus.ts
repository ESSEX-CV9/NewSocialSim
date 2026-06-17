import { useSyncExternalStore } from 'react';

/**
 * 跨面板内容池预览总线：内容池面板点「预览」时发起组装请求并把结果发布到此；
 * 独立的预览器面板订阅展示。与 selection.ts 同范式——模块级 pub/sub 单例，避免跨 dockview 面板传 props。
 */

export interface PreviewState {
  samples: string[];
  msg: string | null;
  loading: boolean;
}

let state: PreviewState = { samples: [], msg: null, loading: false };
const listeners = new Set<() => void>();

function set(s: PreviewState): void {
  state = s;
  for (const l of listeners) l();
}

/** 发起一次预览（组装经模拟器活引擎），结果发布到总线供预览器面板展示。 */
export async function runPreview(pool: unknown, grammars?: Record<string, unknown>): Promise<void> {
  set({ samples: [], msg: null, loading: true });
  const body: Record<string, unknown> = { pool, count: 8 };
  if (grammars) body.grammars = grammars;
  try {
    const res = await fetch(`${window.editor.backendUrl}/api/content-pools/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 503) { set({ samples: [], msg: '模拟器未运行，启动后可预览。', loading: false }); return; }
    const data = (await res.json()) as { samples?: { text: string }[]; failed?: number };
    if (!data.samples?.length) set({ samples: [], msg: `没组装出内容（失败 ${data.failed ?? 0} 次）——检查语法/组件是否齐全。`, loading: false });
    else set({ samples: data.samples.map((s) => s.text), msg: null, loading: false });
  } catch (e) {
    set({ samples: [], msg: String(e), loading: false });
  }
}

export function usePreview(): PreviewState {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => state,
  );
}
