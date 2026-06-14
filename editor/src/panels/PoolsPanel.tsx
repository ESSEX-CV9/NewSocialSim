import { useState, useEffect, useCallback } from 'react';

const ADMIN_KEY = 'dev-admin-key';
const authHeader = { Authorization: `Bearer ${ADMIN_KEY}` };
const jsonHeaders = { ...authHeader, 'Content-Type': 'application/json' };

export function PoolsPanel() {
  const [scenePools, setScenePools] = useState<Record<string, string[]>>({});
  const [topicPools, setTopicPools] = useState<Record<string, string[]>>({});
  const [newKey, setNewKey] = useState('');
  const [newItems, setNewItems] = useState('');
  const [poolType, setPoolType] = useState<'scene' | 'topic'>('scene');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/content-pools', { headers: authHeader });
      const data = await res.json();
      setScenePools(data.scenePools);
      setTopicPools(data.topicPools);
    } catch (e: any) { setError(e.message); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const add = async () => {
    if (!newKey.trim() || !newItems.trim()) return;
    const items = newItems.split('\n').map(s => s.trim()).filter(Boolean);
    try {
      await fetch('/api/admin/content-pools', {
        method: 'POST', headers: jsonHeaders,
        body: JSON.stringify({ poolType, key: newKey.trim(), items }),
      });
      setNewItems('');
      refresh();
    } catch (e: any) { setError(e.message); }
  };

  const clear = async (type: string, key: string) => {
    try {
      await fetch(`/api/admin/content-pools/${type}/${encodeURIComponent(key)}`, {
        method: 'DELETE', headers: authHeader,
      });
      refresh();
    } catch (e: any) { setError(e.message); }
  };

  const pools = poolType === 'scene' ? scenePools : topicPools;
  const totalItems = Object.values(pools).reduce((sum, arr) => sum + arr.length, 0);

  return (
    <div className="rounded-xl border border-gray-700 p-5" style={{ minHeight: 400 }}>
      <h2 className="text-lg font-semibold mb-4">Content Pools</h2>
      {error && <div className="text-red-400 text-sm mb-2">{error}</div>}

      {/* Type selector */}
      <div className="flex gap-2 mb-4">
        {(['scene', 'topic'] as const).map(t => (
          <button key={t} onClick={() => setPoolType(t)}
            className={`px-3 py-1 rounded text-sm ${poolType === t ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'}`}>
            {t === 'scene' ? 'Scene Pools' : 'Topic Pools'}
          </button>
        ))}
        <span className="text-gray-500 text-xs ml-auto mt-1">
          {Object.keys(pools).length} pools · {totalItems} items
        </span>
      </div>

      {/* Pool list */}
      <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
        {Object.entries(pools).map(([key, items]) => (
          <div key={key} className="flex items-start gap-2 text-sm py-2 px-3 bg-gray-800/50 rounded group">
            <div className="flex-1">
              <div className="font-medium">{key} <span className="text-gray-500 text-xs">({items.length} items)</span></div>
              <div className="text-gray-400 text-xs mt-1 truncate">{items.slice(0, 3).join(' / ')}...</div>
            </div>
            <button onClick={() => clear(poolType, key)}
              className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 text-xs shrink-0">Clear</button>
          </div>
        ))}
        {Object.keys(pools).length === 0 && <div className="text-gray-600 text-sm">No pools yet</div>}
      </div>

      {/* Add items */}
      <div className="border-t border-gray-700 pt-4 space-y-2">
        <div className="text-xs text-gray-400 font-medium">Add Items to Pool</div>
        <input className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm w-full"
          placeholder="Pool key (e.g. 'daily-chat' or topic title)..."
          value={newKey} onChange={e => setNewKey(e.target.value)} />
        <textarea rows={4}
          className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm w-full resize-none font-mono"
          placeholder="One item per line..."
          value={newItems} onChange={e => setNewItems(e.target.value)} />
        <button onClick={add} className="bg-blue-600 hover:bg-blue-500 rounded px-3 py-1 text-xs font-medium">Add to Pool</button>
      </div>
    </div>
  );
}
