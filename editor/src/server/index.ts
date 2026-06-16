import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import Fastify from 'fastify';

/** 编辑器后端：renderer 的唯一数据源，聚合/代理社交站 admin API，承载布局存档等编辑器配置。
 *  基础设施配置（端口/社交站地址/数据根目录）经 env，与具体世界无关。 */
const PORT = Number(process.env.EDITOR_BACKEND_PORT ?? 5176);
const SOCIAL_API = (process.env.SOCIALSIM_API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const DATA_DIR = process.env.SOCIALSIM_DATA_DIR ?? path.resolve(__dirname, '..', '..', '..', 'data');

const app = Fastify({ logger: false });

// 本地 renderer（electron file:// 或 vite dev server）跨源访问，放行 localhost。
app.addHook('onRequest', async (req, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') reply.send();
});

app.get('/health', async () => ({ ok: true }));

app.get('/api/worlds/active', async (_req, reply) => {
  try {
    const res = await fetch(`${SOCIAL_API}/api/admin/worlds/active`);
    if (!res.ok) {
      reply.status(res.status);
      return { error: `social API ${res.status}` };
    }
    return await res.json();
  } catch {
    reply.status(502);
    return { error: 'social server unreachable' };
  }
});

// 模拟器状态：转发社交站的心跳态（editor 控制台轮询）。
app.get('/api/simulator/status', async (_req, reply) => {
  try {
    const res = await fetch(`${SOCIAL_API}/api/simulator/status`);
    reply.status(res.status);
    return await res.json();
  } catch {
    reply.status(502);
    return { error: 'social server unreachable' };
  }
});

// 时钟控制：转发到社交站（pause / resume / setScale / setTime）。
app.post('/api/worlds/clock', async (req, reply) => {
  try {
    const res = await fetch(`${SOCIAL_API}/api/admin/worlds/clock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body ?? {}),
    });
    reply.status(res.status);
    return await res.json();
  } catch {
    reply.status(502);
    return { error: 'social server unreachable' };
  }
});

// --- 编辑器布局：跟随活动世界，落该世界文件夹的 editor-layouts.json（编辑器 UI 配置，不进 world.db） ---

interface LayoutsDoc {
  saved: Array<{ name: string; layout: unknown }>;
  last: unknown | null;
}
const EMPTY_LAYOUTS: LayoutsDoc = { saved: [], last: null };

async function activeWorldId(): Promise<string | null> {
  try {
    const res = await fetch(`${SOCIAL_API}/api/admin/worlds/active`);
    if (!res.ok) return null;
    const w = (await res.json()) as { meta?: { id?: string } };
    return w.meta?.id ?? null;
  } catch {
    return null;
  }
}

function layoutsFile(worldId: string): string {
  return path.join(DATA_DIR, 'worlds', worldId, 'editor-layouts.json');
}

app.get('/api/layouts', async (_req, reply) => {
  const id = await activeWorldId();
  if (!id) {
    reply.status(502);
    return { error: 'no active world' };
  }
  try {
    const raw = (await readFile(layoutsFile(id), 'utf-8')).replace(/^﻿/, '');
    return JSON.parse(raw) as LayoutsDoc;
  } catch {
    return EMPTY_LAYOUTS;
  }
});

app.put<{ Body: LayoutsDoc }>('/api/layouts', async (req, reply) => {
  const id = await activeWorldId();
  if (!id) {
    reply.status(502);
    return { error: 'no active world' };
  }
  const doc: LayoutsDoc = {
    saved: Array.isArray(req.body?.saved) ? req.body.saved : [],
    last: req.body?.last ?? null,
  };
  const file = layoutsFile(id);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(doc, null, 2), 'utf-8');
  return { ok: true };
});

app
  .listen({ host: '127.0.0.1', port: PORT })
  .then(() => console.log(`Editor backend on http://127.0.0.1:${PORT} (social API ${SOCIAL_API}, data ${DATA_DIR})`))
  .catch((err) => {
    console.error('Editor backend failed to start:', err);
    process.exit(1);
  });
