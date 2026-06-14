import { useState, useEffect, useCallback } from 'react';

const ADMIN_KEY = 'dev-admin-key';
const authHeader = { Authorization: `Bearer ${ADMIN_KEY}` };
const jsonHeaders = { ...authHeader, 'Content-Type': 'application/json' };

const SOURCES = [
  { id: 'anthropic', label: 'Anthropic (Claude)' },
  { id: 'google', label: 'Google (Gemini)' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'deepseek', label: 'DeepSeek' },
] as const;

interface Provider { id: string; name: string; source: string; baseUrl: string; apiKey: string; models: string[] }
interface AgentLog { taskLabel: string; steps: number; tokens: { input: number; output: number }; timestamp: number; log: Array<{ step: number; role: string; content: string; toolName?: string; toolInput?: Record<string, unknown>; model?: string }> }

export function LlmPanel() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [highModel, setHighModel] = useState('');
  const [lowModel, setLowModel] = useState('');
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [selectedLog, setSelectedLog] = useState<AgentLog | null>(null);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [cfgRes, logsRes] = await Promise.all([
        fetch('/api/admin/llm-config', { headers: authHeader }),
        fetch('/api/admin/agent-logs', { headers: authHeader }),
      ]);
      if (cfgRes.ok) {
        const data = await cfgRes.json();
        setProviders(data.providers ?? []);
        setHighModel(data.highModel ?? '');
        setLowModel(data.lowModel ?? '');
      }
      if (logsRes.ok) {
        const data = await logsRes.json();
        setLogs(data.logs ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refresh(); const t = setInterval(refresh, 10000); return () => clearInterval(t); }, [refresh]);

  const allModels = providers.flatMap(p => p.models.map(m => ({ label: `${p.name} | ${m}`, value: `${p.id}|${m}` })));

  const saveConfig = async () => {
    try {
      const init: RequestInit = { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ providers, highModel, lowModel }) };
      await fetch('/api/admin/llm-config', init);
      setSaved(true); setTimeout(() => setSaved(false), 2000);
      setError('');
    } catch (e: any) { setError(e.message); }
  };

  const addProvider = () => {
    const id = `provider-${Date.now()}`;
    const p: Provider = { id, name: 'New Provider', source: 'deepseek', baseUrl: '', apiKey: '', models: [] };
    setProviders([...providers, p]);
    setEditingProvider(p);
  };

  const updateProvider = (updated: Provider) => {
    setProviders(providers.map(p => p.id === updated.id ? updated : p));
    setEditingProvider(updated);
  };

  const removeProvider = (id: string) => {
    setProviders(providers.filter(p => p.id !== id));
    if (editingProvider?.id === id) setEditingProvider(null);
  };

  const doFetchModels = async () => {
    if (!editingProvider) return;
    setFetchingModels(true);
    try {
      const init: RequestInit = { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ source: editingProvider.source, apiKey: editingProvider.apiKey, baseUrl: editingProvider.baseUrl || undefined }) };
      const res = await fetch('/api/admin/llm-config/fetch-models', init);
      const data = await res.json();
      setFetchedModels(data.models ?? []);
    } catch (e: any) { setError(e.message); }
    setFetchingModels(false);
  };

  const toggleFetchedModel = (modelId: string) => {
    if (!editingProvider) return;
    const models = editingProvider.models.includes(modelId)
      ? editingProvider.models.filter(m => m !== modelId)
      : [...editingProvider.models, modelId];
    updateProvider({ ...editingProvider, models });
  };

  const addManualModel = (modelId: string) => {
    if (!editingProvider || !modelId.trim()) return;
    if (!editingProvider.models.includes(modelId.trim())) {
      updateProvider({ ...editingProvider, models: [...editingProvider.models, modelId.trim()] });
    }
  };

  const runAgent = async () => {
    if (!prompt.trim() || running) return;
    setRunning(true); setError('');
    try {
      const init: RequestInit = { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ prompt: prompt.trim() }) };
      const res = await fetch('/api/admin/run-agent', init);
      if (!res.ok) { const t = await res.text(); setError(`Agent failed: ${res.status} ${t}`); }
      else { setPrompt(''); refresh(); }
    } catch (e: any) { setError(e.message); }
    setRunning(false);
  };

  return (
    <div className="rounded-xl border border-gray-700 p-5" style={{ minHeight: 400 }}>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-semibold">LLM Panel</h2>
        <button onClick={() => setShowConfig(!showConfig)} className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded bg-gray-800 hover:bg-gray-700">
          {showConfig ? 'Hide Config' : 'Config'}
        </button>
        <span className="text-xs text-gray-500">{providers.length} provider(s)</span>
        {saved && <span className="text-xs text-green-400">Saved!</span>}
      </div>
      {error && <div className="text-red-400 text-sm mb-3">{error}</div>}

      {/* Config Panel */}
      {showConfig && (
        <div className="mb-4 p-4 bg-gray-800/50 rounded-lg space-y-4">
          {/* Provider list */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-medium">Providers</span>
            <button onClick={addProvider} className="bg-gray-700 hover:bg-gray-600 rounded px-2 py-0.5 text-xs">+ Add</button>
          </div>
          <div className="flex gap-3">
            <div className="w-48 shrink-0 space-y-1">
              {providers.map(p => (
                <div key={p.id} onClick={() => { setEditingProvider(p); setFetchedModels([]); }}
                  className={`flex items-center gap-1 text-sm py-1.5 px-2 rounded cursor-pointer group ${editingProvider?.id === p.id ? 'bg-gray-700' : 'hover:bg-gray-800'}`}>
                  <span className="flex-1 truncate">{p.name}</span>
                  <span className="text-[10px] text-gray-500">{p.models.length}m</span>
                  <button onClick={e => { e.stopPropagation(); removeProvider(p.id); }} className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 text-xs">✕</button>
                </div>
              ))}
            </div>

            {/* Provider editor */}
            {editingProvider && (
              <div className="flex-1 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Input label="Name" value={editingProvider.name} onChange={v => updateProvider({ ...editingProvider, name: v })} />
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Source</label>
                    <select className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm w-full"
                      value={editingProvider.source} onChange={e => updateProvider({ ...editingProvider, source: e.target.value })}>
                      {SOURCES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </div>
                  <Input label="Base URL (empty = default)" value={editingProvider.baseUrl} onChange={v => updateProvider({ ...editingProvider, baseUrl: v })} />
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">API Key</label>
                    <input type="password" className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm w-full"
                      value={editingProvider.apiKey} onChange={e => updateProvider({ ...editingProvider, apiKey: e.target.value })} />
                  </div>
                </div>

                {/* Models */}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-gray-400">Models ({editingProvider.models.length})</span>
                    <button onClick={doFetchModels} disabled={fetchingModels}
                      className="bg-gray-700 hover:bg-gray-600 rounded px-2 py-0.5 text-[10px]">
                      {fetchingModels ? 'Fetching...' : 'Fetch from API'}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {editingProvider.models.map(m => (
                      <span key={m} className="bg-gray-700 text-xs px-2 py-0.5 rounded flex items-center gap-1">
                        {m}
                        <button onClick={() => updateProvider({ ...editingProvider, models: editingProvider.models.filter(x => x !== m) })}
                          className="text-gray-500 hover:text-red-400">✕</button>
                      </span>
                    ))}
                  </div>
                  {fetchedModels.length > 0 && (
                    <div className="max-h-32 overflow-y-auto bg-gray-900 rounded p-2 space-y-0.5 mb-2">
                      {fetchedModels.map(m => (
                        <label key={m} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-800 px-1 rounded">
                          <input type="checkbox" checked={editingProvider.models.includes(m)} onChange={() => toggleFetchedModel(m)} />
                          {m}
                        </label>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-1">
                    <input id="manual-model" className="bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-xs flex-1"
                      placeholder="Or type model ID manually..." onKeyDown={e => { if (e.key === 'Enter') { addManualModel((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; } }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Global model selection */}
          <div className="border-t border-gray-700 pt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">High-tier Model</label>
              <select className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm w-full"
                value={highModel} onChange={e => setHighModel(e.target.value)}>
                <option value="">-- Select --</option>
                {allModels.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Low-tier Model</label>
              <select className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm w-full"
                value={lowModel} onChange={e => setLowModel(e.target.value)}>
                <option value="">-- Select --</option>
                {allModels.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          </div>
          <button onClick={saveConfig} className="bg-blue-600 hover:bg-blue-500 rounded px-4 py-1.5 text-sm font-medium">Save Config</button>
        </div>
      )}

      {/* Run Agent */}
      <div className="mb-4 p-3 bg-gray-800/50 rounded-lg space-y-2">
        <div className="text-xs text-gray-400 font-medium">Run Agent</div>
        <textarea rows={2} className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm w-full resize-none"
          placeholder="Enter a task..." value={prompt} onChange={e => setPrompt(e.target.value)} />
        <button onClick={runAgent} disabled={running}
          className={`rounded px-3 py-1 text-xs font-medium ${running ? 'bg-gray-700 text-gray-400' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}>
          {running ? 'Running...' : 'Run Agent'}
        </button>
      </div>

      {/* Agent Logs */}
      <div className="flex gap-4">
        <div className="w-64 shrink-0 space-y-1 max-h-96 overflow-y-auto">
          <div className="text-xs text-gray-400 font-medium mb-2">Agent Runs ({logs.length})</div>
          {logs.map((log, i) => (
            <div key={i} className={`text-sm py-2 px-3 rounded cursor-pointer ${selectedLog === log ? 'bg-gray-700' : 'hover:bg-gray-800'}`}
              onClick={() => setSelectedLog(log)}>
              <div className="font-medium truncate">{log.taskLabel}</div>
              <div className="text-xs text-gray-500">{log.steps} steps · {log.tokens.input + log.tokens.output} tok · {new Date(log.timestamp).toLocaleTimeString()}</div>
            </div>
          ))}
          {logs.length === 0 && <div className="text-gray-600 text-sm">No runs yet</div>}
        </div>

        {selectedLog && (
          <div className="flex-1 min-w-0 max-h-96 overflow-y-auto">
            <div className="text-sm font-medium mb-2">{selectedLog.taskLabel}</div>
            <div className="text-xs text-gray-400 mb-3">{selectedLog.steps} steps · {selectedLog.tokens.input}in + {selectedLog.tokens.output}out tokens</div>
            <div className="space-y-2">
              {selectedLog.log.map((entry, i) => (
                <div key={i} className={`text-xs p-2 rounded ${entry.role === 'assistant' ? 'bg-blue-900/30 border border-blue-800/30' : 'bg-gray-800/50 border border-gray-700/30'}`}>
                  <div className="flex gap-2 mb-1">
                    <span className={`font-medium ${entry.role === 'assistant' ? 'text-blue-400' : 'text-green-400'}`}>
                      {entry.role === 'assistant' ? `Assistant (${entry.model ?? 'unknown'})` : `Tool: ${entry.toolName}`}
                    </span>
                    <span className="text-gray-600">Step {entry.step}</span>
                  </div>
                  {entry.toolInput && <div className="text-gray-500 font-mono mb-1 truncate">Input: {JSON.stringify(entry.toolInput)}</div>}
                  <div className="text-gray-300 whitespace-pre-wrap break-words">{entry.content.slice(0, 500)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs text-gray-400 block mb-1">{label}</label>
      <input className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm w-full"
        value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}
