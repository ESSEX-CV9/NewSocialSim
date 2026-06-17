import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import type { StoredSimTraceEvent } from '@socialsim/shared';
import { TraceReader } from './trace-reader.js';
import { TraceSseHub } from './trace-sse.js';

/** 编辑器后端：renderer 的唯一数据源，聚合/代理社交站 admin API，承载布局存档等编辑器配置。
 *  基础设施配置（端口/社交站地址/数据根目录）经 env，与具体世界无关。 */
export const PORT = Number(process.env.EDITOR_BACKEND_PORT ?? 5176);
export const SOCIAL_API = (process.env.SOCIALSIM_API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
export const DATA_DIR = process.env.SOCIALSIM_DATA_DIR ?? path.resolve(__dirname, '..', '..', '..', 'data');

interface LayoutsDoc {
  saved: Array<{ name: string; layout: unknown }>;
  last: unknown | null;
}
const EMPTY_LAYOUTS: LayoutsDoc = { saved: [], last: null };

/** 在路由注册前 await：挂 OpenAPI 文档生成器与 /docs UI（编辑器后端自己的契约面，无鉴权、localhost）。 */
async function registerEditorSwagger(app: FastifyInstance): Promise<void> {
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'NewSocialSim 编辑器后端 API',
        description:
          'Electron 世界编辑器的本地后端（:5176），renderer 的唯一数据源。多为社交站 admin API 的代理，' +
          '另含布局存档与决策轨迹（只读 per-world sim-trace.db）接入。无鉴权——仅 localhost、随编辑器进程。',
        version: '0.1.0',
      },
      servers: [{ url: `http://127.0.0.1:${PORT}`, description: '编辑器后端（本地）' }],
      tags: [
        { name: 'world', description: '活动世界与时钟（代理社交站）' },
        { name: 'simulator', description: '模拟器状态（代理社交站）' },
        { name: 'timeline', description: '时间轴取数（代理社交站全站流 / 账号帖流 / 互动）' },
        { name: 'layouts', description: '编辑器布局存档（随活动世界文件夹）' },
        { name: 'trace', description: '决策轨迹：只读 sim-trace.db + SSE 推流' },
        { name: 'meta', description: '健康检查' },
      ],
    },
  });
  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });
  app.get('/openapi.json', { schema: { hide: true } }, () => app.swagger());
}

/** 把 query 参数原样透传到社交站对应端点并回填状态码。 */
async function proxyGet(
  socialPath: string,
  query: Record<string, unknown>,
  keys: readonly string[],
  reply: FastifyReply,
): Promise<unknown> {
  const u = new URL(`${SOCIAL_API}${socialPath}`);
  for (const k of keys) {
    const v = query[k];
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
}

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

/** 组装编辑器后端 app（不监听）。swagger 须在路由前 await 注册。 */
export async function buildEditorApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // 本地 renderer（electron file:// 或 vite dev server）跨源访问，放行 localhost。
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') reply.send();
  });

  await registerEditorSwagger(app);

  app.get('/health', { schema: { tags: ['meta'], summary: '健康检查', operationId: 'health' } }, async () => ({
    ok: true,
  }));

  app.get(
    '/api/worlds/active',
    { schema: { tags: ['world'], summary: '活动世界（代理社交站）', operationId: 'getActiveWorld' } },
    async (_req, reply) => {
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
    },
  );

  app.get(
    '/api/simulator/status',
    { schema: { tags: ['simulator'], summary: '模拟器状态（代理社交站）', operationId: 'getSimulatorStatus' } },
    async (_req, reply) => {
      try {
        const res = await fetch(`${SOCIAL_API}/api/simulator/status`);
        reply.status(res.status);
        return await res.json();
      } catch {
        reply.status(502);
        return { error: 'social server unreachable' };
      }
    },
  );

  // 列全部账号：转发社交站公开列账号端点，供时间轴列全部轨道（含从未发帖者）。
  app.get<{ Querystring: { cursor?: string; limit?: string } }>(
    '/api/users',
    { schema: { tags: ['timeline'], summary: '列全部账号（代理）', operationId: 'listUsers' } },
    (req, reply) => proxyGet('/api/users', req.query, ['cursor', 'limit'], reply),
  );

  // 账号资料：转发社交站按 handle 取单账号（供时间轴显示昵称）。
  app.get<{ Params: { handle: string } }>(
    '/api/users/:handle',
    { schema: { tags: ['timeline'], summary: '账号资料（代理）', operationId: 'getUser' } },
    async (req, reply) => {
      try {
        const res = await fetch(`${SOCIAL_API}/api/users/${encodeURIComponent(req.params.handle)}`);
        reply.status(res.status);
        return await res.json();
      } catch {
        reply.status(502);
        return { error: 'social server unreachable' };
      }
    },
  );

  // 全站时间流：时间轴块的主数据源（纯读 world.db、与模拟器无关）。
  app.get<{ Querystring: { cursor?: string; limit?: string } }>(
    '/api/timeline/global',
    { schema: { tags: ['timeline'], summary: '全站流（时间轴主轴，代理）', operationId: 'getGlobalTimeline' } },
    (req, reply) => proxyGet('/api/timeline/global', req.query, ['cursor', 'limit'], reply),
  );

  // 账号互动事件流：赞/转/关注（带时间），供时间轴互动块。
  app.get<{ Params: { handle: string }; Querystring: { cursor?: string; limit?: string } }>(
    '/api/users/:handle/interactions',
    { schema: { tags: ['timeline'], summary: '账号互动事件流（代理）', operationId: 'getUserInteractions' } },
    (req, reply) =>
      proxyGet(
        `/api/users/${encodeURIComponent(req.params.handle)}/interactions`,
        req.query,
        ['cursor', 'limit'],
        reply,
      ),
  );

  // 账号时间线：本人帖 + 转发，供时间轴取转发块。
  app.get<{ Params: { handle: string }; Querystring: { cursor?: string; limit?: string } }>(
    '/api/users/:handle/timeline',
    { schema: { tags: ['timeline'], summary: '账号主页流（代理）', operationId: 'getUserTimeline' } },
    (req, reply) =>
      proxyGet(`/api/users/${encodeURIComponent(req.params.handle)}/timeline`, req.query, ['cursor', 'limit'], reply),
  );

  // 账号帖子/回复：时间轴块来源（真相源）。
  app.get<{ Params: { handle: string }; Querystring: { type?: string; cursor?: string; limit?: string } }>(
    '/api/users/:handle/posts',
    { schema: { tags: ['timeline'], summary: '账号帖/回复（代理）', operationId: 'getUserPosts' } },
    (req, reply) =>
      proxyGet(
        `/api/users/${encodeURIComponent(req.params.handle)}/posts`,
        req.query,
        ['type', 'cursor', 'limit'],
        reply,
      ),
  );

  // 时钟控制：转发到社交站（pause / resume / setScale / setTime）。
  app.post(
    '/api/worlds/clock',
    { schema: { tags: ['world'], summary: '时钟控制（代理）', operationId: 'controlClock' } },
    async (req, reply) => {
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
    },
  );

  // --- 编辑器布局：跟随活动世界，落该世界文件夹的 editor-layouts.json（编辑器 UI 配置，不进 world.db） ---

  app.get(
    '/api/layouts',
    { schema: { tags: ['layouts'], summary: '读当前世界编辑器布局', operationId: 'getLayouts' } },
    async (_req, reply) => {
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
    },
  );

  app.put<{ Body: LayoutsDoc }>(
    '/api/layouts',
    { schema: { tags: ['layouts'], summary: '写当前世界编辑器布局', operationId: 'saveLayouts' } },
    async (req, reply) => {
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
    },
  );

  // --- 决策轨迹：只读 per-world sim-trace.db（模拟器独占写、编辑器后端只读），供时间轴渲染 ---

  const traceReader = new TraceReader(DATA_DIR);
  const traceSse = new TraceSseHub();

  /** 按 sim_time 区间查活动世界的轨迹事件；世界没跑过模拟器返回空集。 */
  app.get<{ Querystring: { from?: string; to?: string; entity?: string; limit?: string } }>(
    '/api/trace',
    { schema: { tags: ['trace'], summary: '按模拟时间区间查决策轨迹', operationId: 'getTrace' } },
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

  /** 轨迹实时推流（SSE）。 */
  app.get(
    '/api/trace/stream',
    { schema: { tags: ['trace'], summary: '决策轨迹实时推流（SSE）', operationId: 'streamTrace' } },
    (req, reply) => {
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
    },
  );

  /** 轨迹 ingest：模拟器落盘后尽力而为 POST 一份，后端转发给时间轴 SSE 订阅者。 */
  app.post<{ Body: StoredSimTraceEvent }>(
    '/api/trace/ingest',
    { schema: { tags: ['trace'], summary: '模拟器推送轨迹入口（转发 SSE）', operationId: 'ingestTrace' } },
    async (req, reply) => {
      const e = req.body;
      if (!e || typeof e.id !== 'number' || typeof e.entity !== 'string') {
        reply.status(400);
        return { error: 'bad trace event' };
      }
      traceSse.broadcast(e);
      return { ok: true };
    },
  );

  return app;
}
