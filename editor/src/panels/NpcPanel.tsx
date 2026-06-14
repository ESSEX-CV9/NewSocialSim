import { useState, useEffect, useCallback } from 'react';
import { npcApi } from '../api.js';

interface NpcProfile {
  userId: number;
  handle: string;
  tier: 'core' | 'ambient';
  personality?: string;
  stance?: string;
  writingStyle?: string;
  interests: string[];
  activeHoursStart: number;
  activeHoursEnd: number;
  postProbability: number;
  likeProbability: number;
  repostProbability: number;
  replyProbability: number;
  actionIntervalMinutes: number;
}

export function NpcPanel() {
  const [profiles, setProfiles] = useState<NpcProfile[]>([]);
  const [selected, setSelected] = useState<NpcProfile | null>(null);
  const [editing, setEditing] = useState<Partial<NpcProfile>>({});
  const [users, setUsers] = useState<Array<{ id: number; handle: string; displayName: string }>>([]);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [npcData, userData] = await Promise.all([
        npcApi.list(),
        fetch('/api/admin/users', { headers: { Authorization: 'Bearer dev-admin-key' } }).then(r => r.json()),
      ]);
      setProfiles(npcData.profiles);
      setUsers(userData.users);
      setError('');
    } catch (e: any) { setError(e.message); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const selectProfile = (p: NpcProfile) => {
    setSelected(p);
    setEditing({ ...p });
  };

  const save = async () => {
    if (!editing.userId) return;
    try {
      await npcApi.upsert(editing.userId, editing);
      refresh();
      setSelected(null);
      setEditing({});
    } catch (e: any) { setError(e.message); }
  };

  const addNew = async (userId: number) => {
    try {
      const profile = await npcApi.upsert(userId, { tier: 'ambient', interests: [] });
      setError('');
      refresh();
      selectProfile(profile);
    } catch (e: any) { setError(e.message); }
  };

  const npcUserIds = new Set(profiles.map(p => p.userId));
  const availableUsers = users.filter(u => !npcUserIds.has(u.id));

  const remove = async (userId: number) => {
    try {
      await npcApi.remove(userId);
      if (selected?.userId === userId) { setSelected(null); setEditing({}); }
      refresh();
    } catch (e: any) { setError(e.message); }
  };

  return (
    <div className="rounded-xl border border-gray-700 p-5" style={{ minHeight: 400 }}>
      <h2 className="text-lg font-semibold mb-4">NPC Designer</h2>
      {error && <div className="text-red-400 text-sm mb-2">{error}</div>}

      <div className="flex gap-4">
        {/* List */}
        <div className="w-48 shrink-0 space-y-1">
          {profiles.map(p => (
            <div
              key={p.userId}
              className={`flex items-center gap-1 text-sm py-1 px-2 rounded cursor-pointer group
                ${selected?.userId === p.userId ? 'bg-gray-700' : 'hover:bg-gray-800'}`}
              onClick={() => selectProfile(p)}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${p.tier === 'core' ? 'bg-blue-400' : 'bg-gray-500'}`} />
              <span className="flex-1 truncate">@{p.handle}</span>
              <button
                className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 text-xs"
                onClick={e => { e.stopPropagation(); remove(p.userId); }}
              >✕</button>
            </div>
          ))}
          {availableUsers.length > 0 && (
            <div className="mt-3">
              <div className="text-xs text-gray-500 mb-1">Add user as NPC:</div>
              {availableUsers.map(u => (
                <button
                  key={u.id}
                  onClick={() => addNew(u.id)}
                  className="block w-full text-left text-sm py-1 px-2 rounded hover:bg-gray-800 text-gray-400 hover:text-white"
                >
                  @{u.handle}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Editor */}
        {selected ? (
          <div className="flex-1 space-y-3">
            <div className="text-sm font-medium">@{selected.handle} <span className="text-gray-400">(ID: {selected.userId})</span></div>

            <Field label="Tier">
              <select value={editing.tier ?? 'ambient'} onChange={e => setEditing({ ...editing, tier: e.target.value as 'core' | 'ambient' })}
                className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm">
                <option value="core">Core</option>
                <option value="ambient">Ambient</option>
              </select>
            </Field>

            <Field label="Personality">
              <textarea rows={2} value={editing.personality ?? ''} onChange={e => setEditing({ ...editing, personality: e.target.value })}
                className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm w-full resize-none" />
            </Field>

            <Field label="Stance">
              <input value={editing.stance ?? ''} onChange={e => setEditing({ ...editing, stance: e.target.value })}
                className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm w-full" />
            </Field>

            <Field label="Writing Style">
              <input value={editing.writingStyle ?? ''} onChange={e => setEditing({ ...editing, writingStyle: e.target.value })}
                className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm w-full" />
            </Field>

            <Field label="Interests (comma separated)">
              <input value={(editing.interests ?? []).join(', ')} onChange={e => setEditing({ ...editing, interests: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm w-full" />
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <NumField label="Post %" value={editing.postProbability ?? 0.15} onChange={v => setEditing({ ...editing, postProbability: v })} />
              <NumField label="Like %" value={editing.likeProbability ?? 0.5} onChange={v => setEditing({ ...editing, likeProbability: v })} />
              <NumField label="Repost %" value={editing.repostProbability ?? 0.1} onChange={v => setEditing({ ...editing, repostProbability: v })} />
              <NumField label="Reply %" value={editing.replyProbability ?? 0.05} onChange={v => setEditing({ ...editing, replyProbability: v })} />
              <NumField label="Interval (min)" value={editing.actionIntervalMinutes ?? 60} onChange={v => setEditing({ ...editing, actionIntervalMinutes: v })} />
            </div>

            <button onClick={save} className="bg-blue-600 hover:bg-blue-500 rounded px-4 py-1.5 text-sm font-medium">Save</button>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
            Select an NPC or add one by User ID
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-gray-400 mb-0.5 block">{label}</label>
      {children}
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <Field label={label}>
      <input type="number" step="0.01" value={value} onChange={e => onChange(Number(e.target.value))}
        className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm w-full" />
    </Field>
  );
}
