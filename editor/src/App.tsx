import { useState, useEffect, useCallback } from 'react';

interface SimulatorStatus {
  running: boolean;
  tickNumber: number;
  entityCount: number;
  uptime: number;
  recentActions: ActionLogEntry[];
}

interface ActionLogEntry {
  time: string;
  actor: string;
  action: string;
  detail: string;
}

export function App() {
  return (
    <div className="min-h-screen p-6">
      <header className="mb-8">
        <h1 className="text-2xl font-bold">SocialSim Editor</h1>
        <p className="text-sm text-gray-400 mt-1">World Creation Studio</p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SimulatorPanel />
        <PlaceholderPanel title="Timeline" description="Premiere-style timeline (coming in M5-2)" />
        <PlaceholderPanel title="Lore Documents" description="Obsidian-style editor (coming in M5-2)" />
        <PlaceholderPanel title="LLM Panel" description="Agent observation & control (coming in M5-4)" />
      </div>
    </div>
  );
}

function SimulatorPanel() {
  const [status, setStatus] = useState<SimulatorStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/simulator/status');
      if (!res.ok) {
        setStatus(null);
        setError('Simulator status API not available');
        return;
      }
      const data = await res.json();
      setStatus(data);
      setError(null);
    } catch {
      setStatus(null);
      setError('Cannot connect to server');
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  return (
    <div className="rounded-xl border border-gray-700 p-5">
      <h2 className="text-lg font-semibold mb-4">Simulator Console</h2>

      {error && (
        <div className="text-sm text-gray-400 mb-4">
          {error}
          <p className="mt-2 text-xs">Start the simulator with: <code className="bg-gray-800 px-1.5 py-0.5 rounded">npm run dev:simulator</code></p>
        </div>
      )}

      {status && (
        <>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <StatusCard
              label="Status"
              value={status.running ? 'Running' : 'Stopped'}
              color={status.running ? 'text-green-400' : 'text-red-400'}
            />
            <StatusCard label="Tick" value={`#${status.tickNumber}`} />
            <StatusCard label="Entities" value={String(status.entityCount)} />
          </div>

          {status.recentActions.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-400 mb-2">Recent Actions</h3>
              <div className="space-y-1 max-h-64 overflow-y-auto text-xs font-mono">
                {status.recentActions.map((action, i) => (
                  <div key={i} className="flex gap-2 py-1 border-b border-gray-800">
                    <span className="text-gray-500 shrink-0">{action.time}</span>
                    <span className="text-blue-400 shrink-0">@{action.actor}</span>
                    <span className="text-gray-300">{action.action}</span>
                    <span className="text-gray-500 truncate">{action.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!status && !error && (
        <div className="text-sm text-gray-500">Loading...</div>
      )}
    </div>
  );
}

function StatusCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg bg-gray-800/50 p-3">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className={`text-lg font-semibold ${color ?? 'text-white'}`}>{value}</div>
    </div>
  );
}

function PlaceholderPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-gray-700/50 border-dashed p-5">
      <h2 className="text-lg font-semibold text-gray-500 mb-2">{title}</h2>
      <p className="text-sm text-gray-600">{description}</p>
    </div>
  );
}
