import Fastify from 'fastify';

/** 编辑器后端：renderer 的唯一数据源，聚合/代理社交站 admin API，后续承载轨迹接入与 SSE。
 *  基础设施配置（端口/社交站地址/admin key）经 env，与具体世界无关。 */
const PORT = Number(process.env.EDITOR_BACKEND_PORT ?? 5176);
const SOCIAL_API = (process.env.SOCIALSIM_API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');

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

app
  .listen({ host: '127.0.0.1', port: PORT })
  .then(() => console.log(`Editor backend on http://127.0.0.1:${PORT} (social API ${SOCIAL_API})`))
  .catch((err) => {
    console.error('Editor backend failed to start:', err);
    process.exit(1);
  });
