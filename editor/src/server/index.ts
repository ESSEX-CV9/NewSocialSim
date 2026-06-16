import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import Fastify from 'fastify';
import type { StoredSimTraceEvent } from '@socialsim/shared';
import { TraceReader } from './trace-reader.js';
import { TraceSseHub } from './trace-sse.js';

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

// 账号资料：转发社交站按 handle 取单账号（免鉴权，供时间轴显示昵称）。
app.get<{ Params: { handle: string } }>('/api/users/:handle', async (req, reply) => {
  try {
    const res = await fetch(`${SOCIAL_API}/api/users/${encodeURIComponent(req.params.handle)}`);
    reply.status(res.status);
    return await res.json();
  } catch {
    reply.status(502);
    return { error: 'social server unreachable' };
  }
});

// 全站时间流：转发社交站 global feed（游标分页，免鉴权），时间轴块的主数据源——
// 纯读 world.db、与模拟器无关，故时间轴在模拟器未运行时也可用。
app.get<{ Querystring: { cursor?: string; limit?: string } }>('/api/timeline/global', async (req, reply) => {
  const u = new URL(`${SOCIAL_API}/api/timeline/global`);
  for (const k of ['cursor', 'limit'] as const) {
    const v = req.query[k];
    if (v != null) u.searchParams.set(k, String(v));
  }
  try {
    const res = await fetch(u);
    reply.status(res.status);
    return await res.json();
  } catch {
    reply.status(502);
    return { error: 'social server unreachable' };
  }
});

// 账号互动事件流：转发社交站按 handle 取赞/转/关注事件（带时间），供时间轴互动块。
app.get<{ Params: { handle: string }; Querystring: { cursor?: string; limit?: string } }>(
  '/api/users/:handle/interactions',
  async (req, reply) => {
    const u = new URL(`${SOCIAL_API}/api/users/${encodeURIComponent(req.params.handle)}/interactions`);
    for (const k of ['cursor', 'limit'] as const) {
      const v = req.query[k];
      if (v != null) u.searchParams.set(k, String(v));
    }
    try {
      const res = await fetch(u);
      reply.status(res.status);
      return await res.json();
    } catch {
      reply.status(502);
      return { error: 'social server unreachable' };
    }
  },
);

// 账号时间线：转发社交站按 handle 取其时间线（含本人帖 + 转发），供时间轴取转发块。
app.get<{ Params: { handle: string }; Querystring: { cursor?: string; limit?: string } }>(
  '/api/users/:handle/timeline',
  async (req, reply) => {
    const u = new URL(`${SOCIAL_API}/api/users/${encodeURIComponent(req.params.handle)}/timeline`);
    for (const k of ['cursor', 'limit'] as const) {
      const v = req.query[k];
      if (v != null) u.searchParams.set(k, String(v));
    }
    try {
      const res = await fetch(u);
      reply.status(res.status);
      return await res.json();
    } catch {
      reply.status(502);
      return { error: 'social server unreachable' };
    }
  },
);

// 账号帖子/回复：转发社交站按 handle 列帖（游标分页），供时间轴块来源（真相源）。
app.get<{ Params: { handle: string }; Querystring: { type?: string; cursor?: string; limit?: string } }>(
  '/api/users/:handle/posts',
  async (req, reply) => {
    const u = new URL(`${SOCIAL_API}/api/users/${encodeURIComponent(req.params.handle)}/posts`);
    for (const k of ['type', 'cursor', 'limit'] as const) {
      const v = req.query[k];
      if (v != null) u.searchParams.set(k, String(v));
    }
    try {
      const res = await fetch(u);
      reply.status(res.status);
      return await res.json();
    } catch {
      reply.status(502);
      return { error: 'social server unreachable' };
    }
  },
);

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

// --- 决策轨迹：只读 per-world sim-trace.db（模拟器独占写、编辑器后端只读），供时间轴渲染 ---

const traceReader = new TraceReader(DATA_DIR);
const traceSse = new TraceSseHub();

/** 按 sim_time 区间查活动世界的轨迹事件；世界没跑过模拟器返回空集。 */
app.get<{ Querystring: { from?: string; to?: string; entity?: string; limit?: string } }>(
  '/api/trace',
  async (req, reply) => {
    const id = await activeWorldId();
    if (!id) {
      reply.status(502);
      return { error: 'no active world' };
    }
    const num = (v: string | undefined): number | undefined => {
      if (v === undefined) return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const events = traceReader.query(id, {
      from: num(req.query.from),
      to: num(req.query.to),
      entity: req.query.entity || undefined,
      limit: num(req.query.limit),
    });
    return { events };
  },
);

/** 轨迹实时推流（SSE）；0.9 先只接连接 + 心跳空推，0.11 接 ingest 转发。 */
app.get('/api/trace/stream', (req, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  reply.raw.write('event: ready\ndata: {}\n\n');
  reply.hijack();
  const unregister = traceSse.addClient(reply.raw);
  req.raw.on('close', unregister);
});

/** 轨迹 ingest：模拟器落盘后尽力而为 POST 一份，后端转发给时间轴 SSE 订阅者。 */
app.post<{ Body: StoredSimTraceEvent }>('/api/trace/ingest', async (req, reply) => {
  const e = req.body;
  if (!e || typeof e.id !== 'number' || typeof e.entity !== 'string') {
    reply.status(400);
    return { error: 'bad trace event' };
  }
  traceSse.broadcast(e);
  return { ok: true };
});

app
  .listen({ host: '127.0.0.1', port: PORT })
  .then(() => console.log(`Editor backend on http://127.0.0.1:${PORT} (social API ${SOCIAL_API}, data ${DATA_DIR})`))
  .catch((err) => {
    console.error('Editor backend failed to start:', err);
    process.exit(1);
  });
