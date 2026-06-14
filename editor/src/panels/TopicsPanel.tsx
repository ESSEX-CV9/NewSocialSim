import { useState, useEffect, useCallback } from 'react';

const ADMIN_KEY = 'dev-admin-key';
const headers = { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' };

interface Topic {
  id: number; title: string; description: string; stage: string;
  heat: number; tags: string[]; createdAt: number;
}

const STAGES = ['emerging', 'fermenting', 'peak', 'declining', 'retired'] as const;
const STAGE_COLORS: Record<string, string> = {
  emerging: 'text-cyan-400', fermenting: 'text-yellow-400', peak: 'text-red-400',
  declining: 'text-orange-400', retired: 'text-gray-500',
};

export function TopicsPanel() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selected, setSelected] = useState<Topic | null>(null);
  const [form, setForm] = useState({ title: '', description: '', heat: 0.5, tags: '' });
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/topics', { headers: { Authorization: `Bearer ${ADMIN_KEY}` } });
      const data = await res.json();
      setTopics(data.topics);
    } catch (e: any) { setError(e.message); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const select = (t: Topic) => {
    setSelected(t);
    setForm({ title: t.title, description: t.description, heat: t.heat, tags: t.tags.join(', ') });
  };

  const create = async () => {
    if (!form.title.trim()) return;
    try {
      await fetch('/api/admin/topics', {
        method: 'POST', headers,
        body: JSON.stringify({ title: form.title.trim(), description: form.description, heat: form.heat, tags: form.tags.split(',').map(s => s.trim()).filter(Boolean) }),
      });
      setForm({ title: '', description: '', heat: 0.5, tags: '' });
      refresh();
    } catch (e: any) { setError(e.message); }
  };

  const update = async (id: number, patch: Record<string, unknown>) => {
    try {
      await fetch(`/api/admin/topics/${id}`, { method: 'PATCH', headers, body: JSON.stringify(patch) });
      setSelected(null);
      refresh();
    } catch (e: any) { setError(e.message); }
  };

  const remove = async (id: number) => {
    try {
      await fetch(`/api/admin/topics/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ADMIN_KEY}` } });
      if (selected?.id === id) setSelected(null);
      refresh();
    } catch (e: any) { setError(e.message); }
  };

  return (
    <div className="rounded-xl border border-gray-700 p-5" style={{ minHeight: 400 }}>
      <h2 className="text-lg font-semibold mb-4">Topics / Agenda</h2>
      {error && <div className="text-red-400 text-sm mb-2">{error}</div>}

      {/* Create */}
      <div className="flex gap-2 mb-4">
        <input className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm flex-1"
          placeholder="New topic title..." value={form.title}
          onChange={e => setForm({ ...form, title: e.target.value })}
          onKeyDown={e => e.key === 'Enter' && create()} />
        <button onClick={create} className="bg-blue-600 hover:bg-blue-500 rounded px-3 py-1 text-xs font-medium">Add Topic</button>
      </div>

      {/* List */}
      <div className="space-y-1 mb-4">
        {topics.map(t => (
          <div key={t.id}
            className={`flex items-center gap-2 text-sm py-2 px-3 rounded cursor-pointer group ${selected?.id === t.id ? 'bg-gray-700' : 'hover:bg-gray-800'}`}
            onClick={() => select(t)}>
            <span className={`text-xs font-mono ${STAGE_COLORS[t.stage] ?? ''}`}>{t.stage}</span>
            <span className="flex-1 font-medium">{t.title}</span>
            <span className="text-gray-500 text-xs">heat: {t.heat.toFixed(1)}</span>
            {t.tags.length > 0 && <span className="text-gray-600 text-xs">{t.tags.join(', ')}</span>}
            <button className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 text-xs"
              onClick={e => { e.stopPropagation(); remove(t.id); }}>✕</button>
          </div>
        ))}
        {topics.length === 0 && <div className="text-gray-600 text-sm">No topics yet</div>}
      </div>

      {/* Edit */}
      {selected && (
        <div className="border-t border-gray-700 pt-4 space-y-3">
          <div className="text-sm font-medium">Edit: {selected.title}</div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-400">Title</label>
              <input className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm w-full"
                value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-gray-400">Stage</label>
              <select className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm w-full"
                value={selected.stage} onChange={e => update(selected.id, { stage: e.target.value })}>
                {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400">Heat (0-1)</label>
              <input type="number" step="0.1" min="0" max="1"
                className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm w-full"
                value={form.heat} onChange={e => setForm({ ...form, heat: Number(e.target.value) })} />
            </div>
            <div>
              <label className="text-xs text-gray-400">Tags (comma separated)</label>
              <input className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm w-full"
                value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} />
            </div>
          </div>
          <textarea rows={2} className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm w-full resize-none"
            placeholder="Description..." value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })} />
          <button onClick={() => update(selected.id, {
            title: form.title, description: form.description, heat: form.heat,
            tags: form.tags.split(',').map(s => s.trim()).filter(Boolean),
          })} className="bg-blue-600 hover:bg-blue-500 rounded px-4 py-1 text-sm font-medium">Save</button>
        </div>
      )}
    </div>
  );
}
