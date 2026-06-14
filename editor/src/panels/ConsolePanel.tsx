import { useState, useEffect, useCallback } from 'react';
import { worldsApi, simulatorApi } from '../api.js';

export function ConsolePanel() {
  const [worldInfo, setWorldInfo] = useState<any>(null);
  const [worlds, setWorlds] = useState<any[]>([]);
  const [simStatus, setSimStatus] = useState<any>(null);
  const [snapshots, setSnapshots] = useState<Array<{ name: string; description: string; createdAtRealMs: number }>>([]);
  const [snapshotName, setSnapshotName] = useState('');
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const [active, list, sim] = await Promise.all([
        worldsApi.active().catch(() => null),
        worldsApi.list(),
        simulatorApi.status().catch(() => null),
      ]);
      setWorldInfo(active);
      setWorlds(list.worlds);
      setSimStatus(sim);
      if (active?.meta?.id) {
        const snaps = await worldsApi.listSnapshots(active.meta.id).catch(() => ({ snapshots: [] }));
        setSnapshots(snaps.snapshots);
      }
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);

  const clockAction = async (action: Record<string, unknown>) => {
    try { await worldsApi.clockControl(action); refresh(); } catch (e: any) { setError(e.message); }
  };

  const doCreateSnapshot = async () => {
    const name = snapshotName.trim() || `snap-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`;
    try { await worldsApi.createSnapshot(name); setSnapshotName(''); refresh(); } catch (e: any) { setError(e.message); }
  };

  const doRestore = async (name: string) => {
    if (!worldInfo?.meta?.id) return;
    try { await worldsApi.restoreSnapshot(worldInfo.meta.id, name); refresh(); } catch (e: any) { setError(e.message); }
  };

  const doRemoveSnapshot = async (name: string) => {
    if (!worldInfo?.meta?.id) return;
    try { await worldsApi.removeSnapshot(worldInfo.meta.id, name); refresh(); } catch (e: any) { setError(e.message); }
  };

  const doDelete = async (id: string) => {
    try { await worldsApi.deleteWorld(id); refresh(); } catch (e: any) { setError(e.message); }
  };

  return (
    <div className="rounded-xl border border-gray-700 p-5">
      <h2 className="text-lg font-semibold mb-4">Console</h2>
      {error && <div className="text-red-400 text-sm mb-3">{error}</div>}

      {worldInfo && (
        <>
          <div className="text-sm text-gray-400 mb-1">Active World: <span className="text-white font-medium">{worldInfo.meta.name}</span> ({worldInfo.meta.id})</div>

          {/* Clock */}
          <div className="flex items-center gap-3 my-3">
            <div className="text-sm">
              <span className="text-gray-400">Time: </span>
              <span className="font-mono">{new Date(worldInfo.simTimeMs).toLocaleString()}</span>
            </div>
            <div className="text-sm">
              <span className="text-gray-400">Speed: </span>
              <span className="font-mono">{worldInfo.meta.clock.scale}x</span>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded ${worldInfo.meta.clock.paused ? 'bg-yellow-900 text-yellow-300' : 'bg-green-900 text-green-300'}`}>
              {worldInfo.meta.clock.paused ? 'Paused' : 'Running'}
            </span>
          </div>

          <div className="flex gap-2 mb-4">
            <Btn onClick={() => clockAction({ type: worldInfo.meta.clock.paused ? 'resume' : 'pause' })}>
              {worldInfo.meta.clock.paused ? '▶ Resume' : '⏸ Pause'}
            </Btn>
            {[1, 10, 60, 600].map(s => (
              <Btn key={s} onClick={() => clockAction({ type: 'setScale', scale: s })} active={worldInfo.meta.clock.scale === s}>{s}x</Btn>
            ))}
          </div>

          {/* Snapshots */}
          <div className="mb-4">
            <h3 className="text-sm text-gray-400 mb-2">Snapshots</h3>
            <div className="flex gap-2 mb-2">
              <input
                className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm flex-1"
                placeholder="Snapshot name (optional, auto-generated)"
                value={snapshotName}
                onChange={e => setSnapshotName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doCreateSnapshot()}
              />
              <Btn onClick={doCreateSnapshot}>Save Snapshot</Btn>
            </div>
            {snapshots.length > 0 && (
              <div className="space-y-1">
                {snapshots.map(s => (
                  <div key={s.name} className="flex items-center gap-2 text-sm py-1 border-b border-gray-800">
                    <span className="flex-1 font-mono text-xs">{s.name}</span>
                    <span className="text-gray-600 text-xs">{new Date(s.createdAtRealMs).toLocaleString()}</span>
                    <Btn small onClick={() => doRestore(s.name)}>Restore</Btn>
                    <Btn small danger onClick={() => doRemoveSnapshot(s.name)}>Delete</Btn>
                  </div>
                ))}
              </div>
            )}
            {snapshots.length === 0 && <div className="text-gray-600 text-xs">No snapshots yet</div>}
          </div>
        </>
      )}

      {/* Simulator Status */}
      {simStatus && (
        <div className="mt-3 text-sm">
          <span className="text-gray-400">Simulator: </span>
          <span className={simStatus.running ? 'text-green-400' : 'text-gray-500'}>{simStatus.running ? 'Running' : 'Stopped'}</span>
          {simStatus.running && <span className="text-gray-400 ml-2">Tick #{simStatus.tickNumber} · {simStatus.entityCount} entities</span>}
        </div>
      )}

      {/* World List */}
      {worlds.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm text-gray-400 mb-2">Worlds</h3>
          <div className="space-y-1">
            {worlds.map((w: any) => (
              <div key={w.id} className="flex items-center gap-2 text-sm py-1 border-b border-gray-800">
                <span className={`flex-1 ${w.active ? 'text-white font-medium' : 'text-gray-400'}`}>{w.name}</span>
                <span className="text-gray-600 text-xs">{w.id}</span>
                {!w.active && <Btn small onClick={() => worldsApi.activate(w.id).then(refresh)}>Activate</Btn>}
                {!w.active && <Btn small danger onClick={() => doDelete(w.id)}>Delete</Btn>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Btn({ onClick, children, small, active, danger }: {
  onClick: () => void; children: React.ReactNode; small?: boolean; active?: boolean; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-1 text-xs font-medium transition
        ${small ? 'text-[11px]' : ''}
        ${danger ? 'bg-red-900/50 text-red-300 hover:bg-red-800' :
          active ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`}
    >
      {children}
    </button>
  );
}
