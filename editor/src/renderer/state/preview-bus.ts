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

/** 预览请求：待预览的池（含未保存草稿）+ 可选的未保存语法/组件覆盖。 */
export interface PreviewReq { pool: unknown; grammars?: Record<string, unknown> }

let state: PreviewState = { sample: null, msg: null, loading: false };
/** 当前预览来源：一个**实时读取**当前编辑器草稿的函数（点「预览」时由该编辑器注册）。
 *  「再来一个」通过它取此刻最新草稿，而非某次快照——保证改了设置直接重掷即用新设置。 */
let source: (() => PreviewReq | null) | null = null;
const listeners = new Set<() => void>();

function set(s: PreviewState): void {
  state = s;
  for (const l of listeners) l();
}

/** 注册当前预览来源（编辑器点「预览」时调；传入实时取草稿的函数）。 */
export function setPreviewSource(fn: () => PreviewReq | null): void {
  source = fn;
}

/** 随机模拟一条（经模拟器活引擎），结果发布到总线供预览器面板展示。 */
export async function runPreview(pool: unknown, grammars?: Record<string, unknown>): Promise<void> {
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

/** 「再来一个」：实时取当前来源的最新草稿再随机模拟一条（反映未点预览的现场改动）。 */
export function reroll(): void {
  const req = source?.();
  if (req) void runPreview(req.pool, req.grammars);
  else set({ sample: null, msg: '没有可重掷的预览来源，先在某个池/语法点「预览」。', loading: false });
}

export function usePreview(): PreviewState {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => state,
  );
}
