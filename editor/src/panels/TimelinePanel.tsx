import { useState, useEffect, useCallback } from 'react';
import { adminApi } from '../api.js';

interface PostItem {
  id: number;
  authorId: number;
  authorHandle: string;
  content: string;
  createdAt: number;
}

interface UserOption { id: number; handle: string; displayName: string }

export function TimelinePanel() {
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [simTimeMs, setSimTimeMs] = useState(0);
  const [newPost, setNewPost] = useState({ authorId: 0, content: '', createdAt: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const msToLocal = (ms: number) => {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const loadPosts = useCallback(async () => {
    try {
      const [timelineRes, usersRes, activeRes] = await Promise.all([
        fetch('/api/timeline/global?limit=30'),
        fetch('/api/admin/users', { headers: { Authorization: 'Bearer dev-admin-key' } }),
        fetch('/api/admin/worlds/active'),
      ]);
      if (activeRes.ok) {
        const activeData = await activeRes.json();
        setSimTimeMs(activeData.simTimeMs ?? 0);
      }
      if (timelineRes.ok) {
        const data = await timelineRes.json();
        const items = (data.items ?? []).map((item: any) => {
          const post = item.post ?? item;
          return {
            id: post.id,
            authorId: post.author?.id ?? post.authorId,
            authorHandle: post.author?.handle ?? '?',
            content: post.content ?? '',
            createdAt: post.createdAt,
          };
        });
        setPosts(items);
      }
      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsers(data.users);
        if (!newPost.authorId && data.users.length > 0) {
          setNewPost(p => ({ ...p, authorId: data.users[0].id }));
        }
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadPosts(); }, [loadPosts]);

  const createPost = async () => {
    if (!newPost.authorId || !newPost.content.trim()) {
      setError('Please select an author and enter content');
      return;
    }
    try {
      const body: Record<string, unknown> = { authorId: newPost.authorId, content: newPost.content.trim() };
      if (newPost.createdAt) body.createdAt = new Date(newPost.createdAt).getTime();
      await adminApi.createPost(body as any);
      setNewPost({ authorId: newPost.authorId, content: '', createdAt: '' });
      setError('');
      setSuccess('Post created');
      setTimeout(() => setSuccess(''), 2000);
      loadPosts();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const timeStr = (ms: number) => {
    if (!ms) return '—';
    return new Date(ms).toLocaleString();
  };

  return (
    <div className="rounded-xl border border-gray-700 p-5" style={{ minHeight: 400 }}>
      <h2 className="text-lg font-semibold mb-4">Timeline</h2>
      {error && <div className="text-red-400 text-sm mb-2">{error}</div>}
      {success && <div className="text-green-400 text-sm mb-2">{success}</div>}

      {/* Create post form */}
      <div className="space-y-2 mb-4 p-3 bg-gray-800/50 rounded-lg">
        <div className="text-xs text-gray-400 font-medium">Create / Pre-seed Post</div>
        <div className="flex gap-2">
          <select
            className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm"
            value={newPost.authorId}
            onChange={e => setNewPost({ ...newPost, authorId: Number(e.target.value) })}
          >
            {users.map(u => (
              <option key={u.id} value={u.id}>@{u.handle}</option>
            ))}
          </select>
          <div className="flex flex-col">
            <span className="text-[10px] text-gray-500 mb-0.5">Sim Time</span>
            <input
              type="datetime-local"
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm"
              value={newPost.createdAt || (simTimeMs ? msToLocal(simTimeMs) : '')}
              onChange={e => setNewPost({ ...newPost, createdAt: e.target.value })}
            />
          </div>
        </div>
        <textarea
          rows={2}
          className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm w-full resize-none"
          placeholder="Post content..."
          value={newPost.content}
          onChange={e => setNewPost({ ...newPost, content: e.target.value })}
        />
        <button onClick={createPost} className="bg-blue-600 hover:bg-blue-500 rounded px-3 py-1 text-xs font-medium">Create Post</button>
      </div>

      {/* Post list */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {posts.map(p => (
          <div key={p.id} className="flex gap-3 py-2 border-b border-gray-800 text-sm">
            <div className="shrink-0 text-xs text-gray-500 font-mono w-36">
              {timeStr(p.createdAt)}
            </div>
            <div className="shrink-0 text-blue-400 w-24 truncate">@{p.authorHandle}</div>
            <div className="text-gray-300 flex-1 truncate">{p.content}</div>
          </div>
        ))}
        {posts.length === 0 && <div className="text-gray-600 text-sm">No posts yet</div>}
      </div>

      <button onClick={loadPosts} className="mt-3 bg-gray-700 hover:bg-gray-600 rounded px-3 py-1 text-xs">Refresh</button>
    </div>
  );
}
