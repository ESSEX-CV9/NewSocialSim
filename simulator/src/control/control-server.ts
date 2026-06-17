import http from 'node:http';
import {
  type LoadedPools,
  type PoolPreviewRequest,
  type PoolPreviewResponse,
  type PoolPreviewSample,
} from '@socialsim/shared';
import { assembleDetailed, seededRng } from '../content-pool/assembler.js';
import { logger } from '../logger.js';

/**
 * 模拟器本地控制接口（1.6，见 docs/m5-x-re-plan.md「编辑器↔模拟器控制通道」）。
 *
 * 仅绑 127.0.0.1，供编辑器后端代理"需要模拟器活引擎/活状态算结果"的请求。首个能力是内容池预览：
 * 编辑器发来待预览的池（可含未保存草稿），模拟器用当前世界已加载的组件/语法库 + 真组装引擎产几条返回，
 * 保证预览与真实发帖一致。引擎留在模拟器、不抽公共包——为内容生成必然演进到依赖 NPC 活状态/LLM 预留。
 */
export interface ControlDeps {
  boundWorldId(): string | null;
  getPools(): LoadedPools | null;
  exprVarDefault(): number;
  optionalProb(): number;
}

export function startControlServer(port: number, deps: ControlDeps): http.Server {
  const server = http.createServer((req, res) => {
    void handle(req, res, deps).catch((err) => {
      logger.error('控制接口处理出错:', err);
      sendJson(res, 500, { error: String(err) });
    });
  });
  server.on('error', (err) => logger.error(`控制接口监听失败（端口 ${port}）:`, err));
  server.listen(port, '127.0.0.1', () => logger.info(`Control endpoint on http://127.0.0.1:${port}`));
  return server;
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse, deps: ControlDeps): Promise<void> {
  const url = req.url ?? '/';
  if (req.method === 'GET' && url.startsWith('/health')) {
    sendJson(res, 200, { ok: true, boundWorldId: deps.boundWorldId() });
    return;
  }
  if (req.method === 'POST' && url.startsWith('/preview')) {
    const body = (await readJson(req)) as PoolPreviewRequest;
    sendJson(res, 200, preview(body, deps));
    return;
  }
  sendJson(res, 404, { error: 'not found' });
}

function preview(req: PoolPreviewRequest, deps: ControlDeps): PoolPreviewResponse {
  const loaded = deps.getPools();
  if (!loaded || !req?.pool) return { samples: [], failed: 0 };

  // 未保存的组件/语法草稿覆盖在已加载库之上，使预览反映未存改动。
  const effective: LoadedPools = {
    components: { ...loaded.components, ...(req.components ?? {}) },
    grammars: { ...loaded.grammars, ...(req.grammars ?? {}) },
    pools: loaded.pools,
  };
  const count = Math.min(Math.max(req.count ?? 8, 1), 50);
  // 给了 seed 则可复现；否则每次随机以便多看几种样子（预览非业务时间，用 Math.random 无碍）。
  const baseSeed = req.seed ?? Math.floor(Math.random() * 0xffffffff);
  const exprVarDefault = deps.exprVarDefault();
  const optionalProb = deps.optionalProb();

  const samples: PoolPreviewSample[] = [];
  let failed = 0;
  for (let i = 0; i < count; i++) {
    const rng = seededRng((baseSeed + i * 0x9e3779b1) >>> 0);
    const r = assembleDetailed(req.pool, { pools: effective, rng, vars: req.vars, exprVarDefault, optionalProb });
    if (r) samples.push(r);
    else failed++;
  }
  return { samples, failed };
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 5_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
