import { useEffect, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview';

interface ActiveWorld {
  meta: { id: string; name: string; clock: { simTimeMs: number; scale: number; paused: boolean } };
  simTimeMs: number;
}

type Status =
  | { kind: 'loading' }
  | { kind: 'ok'; world: ActiveWorld }
  | { kind: 'error'; message: string };

/** 当前活动世界一次性读取（实时跟随留待 0.6 控制台）。数据经编辑器后端代理社交站。 */
export function WorldStatusPanel(_props: IDockviewPanelProps) {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    fetch(`${window.editor.backendUrl}/api/worlds/active`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`backend ${res.status}`);
        return (await res.json()) as ActiveWorld;
      })
      .then((world) => setStatus({ kind: 'ok', world }))
      .catch((err: unknown) => setStatus({ kind: 'error', message: String(err) }));
  }, []);

  return (
    <div className="p-4">
      {status.kind === 'loading' && <p className="text-gray-400 text-sm">连接编辑器后端…</p>}
      {status.kind === 'error' && (
        <p className="text-red-400 text-sm">无法从编辑器后端取活动世界：{status.message}</p>
      )}
      {status.kind === 'ok' && (
        <div className="space-y-1">
          <p className="text-gray-400 text-sm">当前活动世界</p>
          <p className="text-2xl font-semibold">{status.world.meta.name}</p>
          <p className="text-gray-500 text-sm">
            id <code className="text-gray-300">{status.world.meta.id}</code> · 流速 ×
            {status.world.meta.clock.scale} · {status.world.meta.clock.paused ? '已暂停' : '运行中'}
          </p>
        </div>
      )}
    </div>
  );
}
