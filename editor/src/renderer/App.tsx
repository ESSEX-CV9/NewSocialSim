import { useEffect, useState } from 'react';

interface ActiveWorld {
  meta: { id: string; name: string; clock: { simTimeMs: number; scale: number; paused: boolean } };
  simTimeMs: number;
}

type Status =
  | { kind: 'loading' }
  | { kind: 'ok'; world: ActiveWorld }
  | { kind: 'error'; message: string };

export function App() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    const url = `${window.editor.backendUrl}/api/worlds/active`;
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`backend ${res.status}`);
        return (await res.json()) as ActiveWorld;
      })
      .then((world) => setStatus({ kind: 'ok', world }))
      .catch((err: unknown) => setStatus({ kind: 'error', message: String(err) }));
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center gap-4 px-6 py-3 border-b border-gray-800">
        <h1 className="text-lg font-bold">SocialSim Studio</h1>
        <span className="text-xs text-gray-500">editor backend: {window.editor.backendUrl}</span>
      </header>
      <main className="flex-1 p-6">
        {status.kind === 'loading' && <p className="text-gray-400">连接编辑器后端…</p>}
        {status.kind === 'error' && (
          <p className="text-red-400">无法从编辑器后端取活动世界：{status.message}</p>
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
      </main>
    </div>
  );
}
