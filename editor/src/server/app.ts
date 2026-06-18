import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import type { StoredSimTraceEvent } from '@socialsim/shared';
import { aggregateTimeline } from './timeline-aggregator.js';
import { TraceReader } from './trace-reader.js';
import { TraceSseHub } from './trace-sse.js';
import {
  readPools,
  saveEntry,
  deleteEntry,
  type PoolLayer,
  type PoolScope,
} from './pool-files.js';

/** 编辑器后端：renderer 的唯一数据源，聚合/代理社交站 admin API，承载布局存档等编辑器配置。
 *  基础设施配置（端口/社交站地址/数据根目录）经 env，与具体世界无关。 */
export const PORT = Number(process.env.EDITOR_BACKEND_PORT ?? 5176);
export const SOCIAL_API = (process.env.SOCIALSIM_API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
export const DATA_DIR = process.env.SOCIALSIM_DATA_DIR ?? path.resolve(__dirname, '..', '..', '..', 'data');
/** 模拟器本地控制接口地址（基础设施配置）：内容池预览代理到这里。 */
export const SIM_CONTROL = (process.env.SOCIALSIM_CONTROL_URL ?? 'http://127.0.0.1:5177').replace(/\/$/, '');

interface LayoutsDoc {
  saved: Array<{ name: string; layout: unknown }>;
  last: unknown | null;
  /** 每个预设的自定义版本（按预设 id），使对预设的修改跨切换保留。 */
  presets?: Record<string, unknown>;
  /** 上次活动布局（{kind:'preset',id} | {kind:'saved',name}），供重开恢复到正确的槽。 */
  lastActive?: unknown | null;
  /** 旧字段，仅保留供迁移读取。 */
  lastPresetId?: string | null;
}

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
        { name: 'pools', description: '内容池：读写世界文件夹三层池文件 + 预览（代理模拟器活引擎）' },
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

/**
 * 读该世界布局存档（BOM 容错）。**区分两种"读不到"**：
 * - 文件不存在（ENOENT）→ 返回空 doc（正常新建场景）。
 * - 文件存在但读/解析失败（如并发写到一半被读到半截）→ **抛错**，让调用方中止本次写，
 *   绝不返回空 doc 把好数据覆盖成空（这是 #3 被并发冲空的真凶）。
 */
async function readLayouts(worldId: string): Promise<LayoutsDoc> {
  let raw: string;
  try {
    raw = (await readFile(layoutsFile(worldId), 'utf-8')).replace(/^﻿/, '');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { saved: [], last: null, presets: {}, lastActive: null, lastPresetId: null };
    }
    throw err; // 其它读错误：上抛、不冲数据
  }
  const doc = JSON.parse(raw) as Partial<LayoutsDoc>; // 解析失败上抛（半截文件）→ 中止写
  return {
    saved: Array.isArray(doc.saved) ? doc.saved : [],
    last: doc.last ?? null,
    presets: doc.presets && typeof doc.presets === 'object' ? doc.presets : {},
    lastActive: doc.lastActive ?? null,
    lastPresetId: doc.lastPresetId ?? null,
  };
}

/** 原子写：先写 .tmp 再 rename 覆盖（同目录 rename 原子）。读者永远看到完整旧/新文件，杜绝半截读。 */
async function writeLayouts(worldId: string, doc: LayoutsDoc): Promise<void> {
  const file = layoutsFile(worldId);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(doc, null, 2), 'utf-8'); // 无 BOM（给 Node 读的 JSON）
  await rename(tmp, file);
}

/**
 * 串行化所有布局 read-modify-write：单进程一条 Promise 链，保证一个端点的"读→改→写"整段完成后
 * 下一个才开始。消除并发交错导致的 lost update 与冲空。GET 只读、配合原子写无需入锁。
 */
let layoutsChain: Promise<unknown> = Promise.resolve();
function lockLayouts<T>(fn: () => Promise<T>): Promise<T> {
  const run = layoutsChain.then(fn, fn);
  layoutsChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
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

  // 单帖：按 id 取一条帖（供检视器展示回复/引用块的原帖内容）。
  app.get<{ Params: { id: string } }>(
    '/api/posts/:id',
    { schema: { tags: ['timeline'], summary: '按 id 取单帖（代理）', operationId: 'getPost' } },
    async (req, reply) => {
      try {
        const res = await fetch(`${SOCIAL_API}/api/posts/${encodeURIComponent(req.params.id)}`);
        reply.status(res.status);
        return await res.json();
      } catch {
        reply.status(502);
        return { error: 'social server unreachable' };
      }
    },
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

  // 全站时间流：时间轴块的主数据源（纯读 world.db、与模拟器无关）。from/to 供时间跳转（T.2）。
  app.get<{ Querystring: { cursor?: string; limit?: string; from?: string; to?: string } }>(
    '/api/timeline/global',
    { schema: { tags: ['timeline'], summary: '全站流（时间轴主轴，代理）', operationId: 'getGlobalTimeline' } },
    (req, reply) => proxyGet('/api/timeline/global', req.query, ['cursor', 'limit', 'from', 'to'], reply),
  );

  // 时间轴聚合（T.3）：renderer 的单一取数接口——合并 roster + 顶层帖 + 各账号回复/互动。
  app.get<{
    Querystring: { cursor?: string; limit?: string; from?: string; to?: string; accounts?: string; axisOnly?: string };
  }>(
    '/api/timeline',
    { schema: { tags: ['timeline'], summary: '时间轴聚合（roster + 帖 + 回复 + 互动）', operationId: 'getTimeline' } },
    async (req, reply) => {
      const num = (v: string | undefined): number | undefined => {
        if (v == null || v === '') return undefined;
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
      };
      try {
        return await aggregateTimeline(SOCIAL_API, {
          cursor: req.query.cursor,
          limit: num(req.query.limit),
          from: num(req.query.from),
          to: num(req.query.to),
          accounts: req.query.accounts ? req.query.accounts.split(',').filter(Boolean) : undefined,
          axisOnly: req.query.axisOnly === '1',
        });
      } catch {
        reply.status(502);
        return { error: 'social server unreachable' };
      }
    },
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
  // 后端是权威源：每个变更端点都 read-modify-write **单个字段**，绝不让前端用本地副本整体覆盖——
  // 否则前端 doc 未加载好/为空时的一次写会冲掉其它字段（命名布局/预设自定义），且形成"读空→写空"死循环。

  app.get(
    '/api/layouts',
    { schema: { tags: ['layouts'], summary: '读当前世界编辑器布局', operationId: 'getLayouts' } },
    async (_req, reply) => {
      const id = await activeWorldId();
      if (!id) {
        reply.status(502);
        return { error: 'no active world' };
      }
      // 只读展示：读/解析失败也别 500 进重试死循环，退回空 doc（原子写下基本不会发生）。
      try {
        return await readLayouts(id);
      } catch {
        return { saved: [], last: null, presets: {}, lastActive: null, lastPresetId: null };
      }
    },
  );

  /** 取活动世界 id；无则回 502。供下列各布局合并端点统一前置。 */
  async function requireWorld(reply: FastifyReply): Promise<string | null> {
    const id = await activeWorldId();
    if (!id) {
      reply.status(502);
      return null;
    }
    return id;
  }

  // 合并写一条命名布局（按 name 替换或追加）——不触碰 presets/last/其它命名布局。
  app.put<{ Body: { name?: string; layout?: unknown } }>(
    '/api/layouts/saved',
    { schema: { tags: ['layouts'], summary: '保存/更新一条命名布局（合并）', operationId: 'saveNamedLayout' } },
    async (req, reply) => {
      const id = await requireWorld(reply);
      if (!id) return { error: 'no active world' };
      const name = req.body?.name;
      if (typeof name !== 'string' || !name.trim()) {
        reply.status(400);
        return { error: 'bad name' };
      }
      try {
        return await lockLayouts(async () => {
          const doc = await readLayouts(id);
          doc.saved = [...doc.saved.filter((s) => s.name !== name), { name, layout: req.body!.layout }];
          await writeLayouts(id, doc);
          return { ok: true, saved: doc.saved.map((s) => s.name) };
        });
      } catch (e) {
        reply.status(500);
        return { error: String(e) }; // 读到半截/读错 → 中止写、不冲数据
      }
    },
  );

  // 删除一条命名布局——不触碰其它字段。
  app.delete<{ Body: { name?: string } }>(
    '/api/layouts/saved',
    { schema: { tags: ['layouts'], summary: '删除一条命名布局（合并）', operationId: 'deleteNamedLayout' } },
    async (req, reply) => {
      const id = await requireWorld(reply);
      if (!id) return { error: 'no active world' };
      const name = req.body?.name;
      if (typeof name !== 'string') {
        reply.status(400);
        return { error: 'bad name' };
      }
      try {
        return await lockLayouts(async () => {
          const doc = await readLayouts(id);
          doc.saved = doc.saved.filter((s) => s.name !== name);
          await writeLayouts(id, doc);
          return { ok: true, saved: doc.saved.map((s) => s.name) };
        });
      } catch (e) {
        reply.status(500);
        return { error: String(e) };
      }
    },
  );

  // 合并写某预设的自定义版本——不触碰 saved/last/其它预设。
  app.put<{ Body: { id?: string; layout?: unknown } }>(
    '/api/layouts/preset',
    { schema: { tags: ['layouts'], summary: '保存某预设的自定义布局（合并）', operationId: 'savePresetLayout' } },
    async (req, reply) => {
      const id = await requireWorld(reply);
      if (!id) return { error: 'no active world' };
      const presetId = req.body?.id;
      if (typeof presetId !== 'string' || !presetId) {
        reply.status(400);
        return { error: 'bad preset id' };
      }
      try {
        return await lockLayouts(async () => {
          const doc = await readLayouts(id);
          doc.presets = { ...doc.presets, [presetId]: req.body!.layout };
          await writeLayouts(id, doc);
          return { ok: true };
        });
      } catch (e) {
        reply.status(500);
        return { error: String(e) };
      }
    },
  );

  // 合并写 last + lastActive（"重启恢复哪个布局" = 恢复 last）——不触碰 saved/presets。
  app.put<{ Body: { last?: unknown; lastActive?: unknown } }>(
    '/api/layouts/last',
    { schema: { tags: ['layouts'], summary: '保存当前(last)布局与活动布局描述（合并）', operationId: 'saveLastLayout' } },
    async (req, reply) => {
      const id = await requireWorld(reply);
      if (!id) return { error: 'no active world' };
      try {
        return await lockLayouts(async () => {
          const doc = await readLayouts(id);
          doc.last = req.body?.last ?? null;
          doc.lastActive = req.body?.lastActive ?? null;
          await writeLayouts(id, doc);
          return { ok: true };
        });
      } catch (e) {
        reply.status(500);
        return { error: String(e) };
      }
    },
  );

  // --- 决策轨迹：只读 per-world sim-trace.db（模拟器独占写、编辑器后端只读），供时间轴渲染 ---

  const traceReader = new TraceReader(DATA_DIR);
  const traceSse = new TraceSseHub();

  /** 按 sim_time 区间查活动世界的轨迹事件；世界没跑过模拟器返回空集。 */
  app.get<{
    Querystring: {
      from?: string;
      to?: string;
      entity?: string;
      limit?: string;
      postId?: string;
      targetPostId?: string;
      action?: string;
    };
  }>(
    '/api/trace',
    { schema: { tags: ['trace'], summary: '按模拟时间区间查决策轨迹（postId/targetPostId/action 精确关联块）', operationId: 'getTrace' } },
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
        postId: req.query.postId || undefined,
        targetPostId: req.query.targetPostId || undefined,
        action: req.query.action || undefined,
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

  // --- 内容池：读写当前世界的三层池文件（编辑器后端是唯一写方，模拟器只读 + 热重载） ---

  app.get(
    '/api/content-pools',
    { schema: { tags: ['pools'], summary: '读当前世界内容池三层（组件/语法/池，带 provenance）', operationId: 'getContentPools' } },
    async (_req, reply) => {
      const id = await activeWorldId();
      if (!id) {
        reply.status(502);
        return { error: 'no active world' };
      }
      return await readPools(DATA_DIR, id);
    },
  );

  app.post<{ Body: { layer?: PoolLayer; key?: string; entry?: unknown; scope?: PoolScope; group?: string } }>(
    '/api/content-pools/save',
    { schema: { tags: ['pools'], summary: '新建/更新一个条目（一条一文件，分组=子文件夹，缺 scope 则落世界层）', operationId: 'saveContentPool' } },
    async (req, reply) => {
      const id = await activeWorldId();
      if (!id) {
        reply.status(502);
        return { error: 'no active world' };
      }
      const { layer, key, entry, scope, group } = req.body ?? {};
      if ((layer !== 'component' && layer !== 'grammar' && layer !== 'pool') || !key) {
        reply.status(400);
        return { error: 'bad layer/key' };
      }
      try {
        await saveEntry(DATA_DIR, id, { layer, key, entry, scope, group });
        return { ok: true };
      } catch (err) {
        reply.status(400);
        return { error: String(err) };
      }
    },
  );

  app.post<{ Body: { layer?: PoolLayer; key?: string; scope?: PoolScope; group?: string } }>(
    '/api/content-pools/delete',
    { schema: { tags: ['pools'], summary: '删除一个条目（删其 <分组?>/<名字>.json）', operationId: 'deleteContentPool' } },
    async (req, reply) => {
      const id = await activeWorldId();
      if (!id) {
        reply.status(502);
        return { error: 'no active world' };
      }
      const { layer, key, scope, group } = req.body ?? {};
      if ((layer !== 'component' && layer !== 'grammar' && layer !== 'pool') || !key || (scope !== 'global' && scope !== 'world')) {
        reply.status(400);
        return { error: 'bad layer/key/scope' };
      }
      try {
        await deleteEntry(DATA_DIR, id, { layer, key, scope, group });
        return { ok: true };
      } catch (err) {
        reply.status(400);
        return { error: String(err) };
      }
    },
  );

  // 预览：代理到模拟器本地控制接口，用其活引擎组装（模拟器未运行则 503，renderer 优雅提示）。
  app.post(
    '/api/content-pools/preview',
    { schema: { tags: ['pools'], summary: '内容池预览（代理模拟器活引擎）', operationId: 'previewContentPool' } },
    async (req, reply) => {
      try {
        const res = await fetch(`${SIM_CONTROL}/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req.body ?? {}),
        });
        reply.status(res.status);
        return await res.json();
      } catch {
        reply.status(503);
        return { error: 'simulator not running' };
      }
    },
  );

  return app;
}
