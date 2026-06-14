const ADMIN_KEY = 'dev-admin-key';

const authOnly = { Authorization: `Bearer ${ADMIN_KEY}` };
const withJson = { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_KEY}` };

function headersFor(body: unknown) {
  return body !== undefined ? withJson : authOnly;
}

async function get(path: string) {
  const res = await fetch(path, { headers: authOnly });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return res.json();
}

async function post(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: headersFor(body),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : undefined;
}

async function put(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: 'PUT',
    headers: headersFor(body),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`PUT ${path}: ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : undefined;
}

async function patch(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: 'PATCH',
    headers: headersFor(body),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`PATCH ${path}: ${res.status}`);
  return res.json();
}

async function del(path: string) {
  const res = await fetch(path, { method: 'DELETE', headers: authOnly });
  if (!res.ok && res.status !== 204) throw new Error(`DELETE ${path}: ${res.status}`);
}

// --- Worlds ---
export const worldsApi = {
  list: () => get('/api/admin/worlds') as Promise<{ worlds: any[] }>,
  active: () => get('/api/admin/worlds/active') as Promise<{ meta: any; simTimeMs: number }>,
  activate: (id: string) => post(`/api/admin/worlds/${id}/activate`),
  update: (id: string, patch_: Record<string, unknown>) => patch(`/api/admin/worlds/${id}`, patch_),
  clockControl: (action: Record<string, unknown>) => post('/api/admin/worlds/clock', action),
  copyWorld: (id: string, newId: string) => post(`/api/admin/worlds/${id}/copy`, { newId }),
  createSnapshot: (name: string, description?: string) => post('/api/admin/worlds/snapshots', { name, description }),
  listSnapshots: (id: string) => get(`/api/admin/worlds/${id}/snapshots`) as Promise<{ snapshots: Array<{ name: string; description: string; createdAtRealMs: number }> }>,
  restoreSnapshot: (id: string, name: string) => post(`/api/admin/worlds/${id}/snapshots/${name}/restore`),
  removeSnapshot: (id: string, name: string) => del(`/api/admin/worlds/${id}/snapshots/${name}`),
  deleteWorld: (id: string) => del(`/api/admin/worlds/${id}`),
};

// --- Lore ---
export const loreApi = {
  list: () => get('/api/admin/lore') as Promise<{ files: Array<{ filename: string; summary: string; sizeBytes: number }> }>,
  read: (filename: string) => get(`/api/admin/lore/${encodeURIComponent(filename)}`) as Promise<{ filename: string; content: string }>,
  write: (filename: string, content: string) => put(`/api/admin/lore/${encodeURIComponent(filename)}`, { content }),
  remove: (filename: string) => del(`/api/admin/lore/${encodeURIComponent(filename)}`),
};

// --- NPC Profiles ---
export const npcApi = {
  list: () => get('/api/admin/npc-profiles') as Promise<{ profiles: any[] }>,
  get: (userId: number) => get(`/api/admin/npc-profiles/${userId}`),
  upsert: (userId: number, data: Record<string, unknown>) => put(`/api/admin/npc-profiles/${userId}`, data),
  remove: (userId: number) => del(`/api/admin/npc-profiles/${userId}`),
};

// --- Admin Posts ---
export const adminApi = {
  createPost: (data: { authorId: number; content: string; createdAt?: number; replyToId?: number }) =>
    post('/api/admin/posts', data),
  bulkImport: (data: { posts?: any[]; follows?: any[]; counts?: any[] }) =>
    post('/api/admin/import', data),
};

// --- Simulator ---
export const simulatorApi = {
  status: () => get('/api/simulator/status'),
};
