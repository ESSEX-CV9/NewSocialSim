import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { REQUIRE_ADMIN } from '../../core/openapi/swagger.js';
import { AdminController } from './admin.controller.js';
import type { AdminService } from './admin.service.js';
import type { LoreService } from './lore.service.js';
import type { NpcService } from './npc.service.js';
import { UnauthorizedError } from '../../core/errors/app-error.js';

const TAG = 'admin';

// --- 请求体 / 路径参数 schema（镜像各路由的 TS 泛型形态，供 OpenAPI 文档与运行时校验）---

const adminPostBodySchema = {
  type: 'object',
  required: ['authorId', 'content'],
  additionalProperties: false,
  properties: {
    authorId: { type: 'integer' },
    content: { type: 'string' },
    createdAt: { type: 'integer', description: '世界模拟时间（建历史帖时指定）' },
    replyToId: { type: 'integer' },
    quoteOfId: { type: 'integer' },
  },
} as const;

const bulkFollowBodySchema = {
  type: 'object',
  required: ['pairs'],
  additionalProperties: false,
  properties: {
    pairs: {
      type: 'array',
      items: {
        type: 'object',
        required: ['followerId', 'followeeId'],
        additionalProperties: false,
        properties: { followerId: { type: 'integer' }, followeeId: { type: 'integer' } },
      },
    },
  },
} as const;

const updateCountsBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    likeCount: { type: 'integer', minimum: 0 },
    repostCount: { type: 'integer', minimum: 0 },
    replyCount: { type: 'integer', minimum: 0 },
    viewCount: { type: 'integer', minimum: 0 },
  },
} as const;

const bulkImportBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    posts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['authorId', 'content'],
        additionalProperties: false,
        properties: {
          authorId: { type: 'integer' },
          content: { type: 'string' },
          createdAt: { type: 'integer' },
          replyToId: { type: 'integer' },
        },
      },
    },
    follows: {
      type: 'array',
      items: {
        type: 'object',
        required: ['followerId', 'followeeId'],
        additionalProperties: false,
        properties: { followerId: { type: 'integer' }, followeeId: { type: 'integer' } },
      },
    },
    counts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['postId'],
        additionalProperties: false,
        properties: {
          postId: { type: 'integer' },
          likeCount: { type: 'integer' },
          repostCount: { type: 'integer' },
          viewCount: { type: 'integer' },
        },
      },
    },
  },
} as const;

const writeLoreBodySchema = {
  type: 'object',
  required: ['content'],
  additionalProperties: false,
  properties: { content: { type: 'string' } },
} as const;

const createTopicBodySchema = {
  type: 'object',
  required: ['title'],
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    heat: { type: 'number' },
    tags: { type: 'array', items: { type: 'string' } },
  },
} as const;

const addToPoolBodySchema = {
  type: 'object',
  required: ['poolType', 'key', 'items'],
  additionalProperties: false,
  properties: {
    poolType: { type: 'string' },
    key: { type: 'string' },
    items: { type: 'array', items: { type: 'string' } },
  },
} as const;

const createUserBodySchema = {
  type: 'object',
  required: ['handle', 'displayName'],
  additionalProperties: false,
  properties: {
    handle: { type: 'string', description: '须拟真，禁止 sim_/bot/npc/序号后缀等暴露虚拟身份的命名' },
    displayName: { type: 'string' },
    password: { type: 'string', description: '不给则随机生成并在响应返回' },
  },
} as const;

const loginAsBodySchema = {
  type: 'object',
  required: ['userId'],
  additionalProperties: false,
  properties: { userId: { type: 'integer' } },
} as const;

const fetchModelsBodySchema = {
  type: 'object',
  required: ['source', 'apiKey'],
  additionalProperties: false,
  properties: {
    source: { type: 'string' },
    apiKey: { type: 'string' },
    baseUrl: { type: 'string' },
  },
} as const;

const runAgentBodySchema = {
  type: 'object',
  required: ['prompt'],
  additionalProperties: false,
  properties: { prompt: { type: 'string' } },
} as const;

const heartbeatBodySchema = {
  type: 'object',
  required: ['boundWorldId', 'accountCount', 'tickNumber', 'lastFlushedWorldId', 'lastFlushAt'],
  additionalProperties: false,
  properties: {
    boundWorldId: { type: ['string', 'null'] },
    accountCount: { type: 'integer' },
    tickNumber: { type: 'integer' },
    lastFlushedWorldId: { type: ['string', 'null'] },
    lastFlushAt: { type: ['integer', 'null'] },
  },
} as const;

/** 自由形态对象体（NPC 档案 / 话题改 / LLM 配置存——结构随业务演进，此处不锁字段）。 */
const freeformObjectBodySchema = { type: 'object', additionalProperties: true } as const;

const idParamsSchema = { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } as const;
const filenameParamsSchema = {
  type: 'object',
  required: ['filename'],
  properties: { filename: { type: 'string' } },
} as const;
const userIdParamsSchema = {
  type: 'object',
  required: ['userId'],
  properties: { userId: { type: 'string' } },
} as const;
const poolParamsSchema = {
  type: 'object',
  required: ['poolType', 'key'],
  properties: { poolType: { type: 'string' }, key: { type: 'string' } },
} as const;

export interface AdminRoutesDeps {
  adminService: AdminService;
  loreService: LoreService;
  npcService: NpcService;
  adminKey: string;
}

export function registerAdminRoutes(app: FastifyInstance, deps: AdminRoutesDeps): void {
  const controller = new AdminController(deps.adminService, deps.loreService, deps.npcService);
  const requireAdmin = makeAdminKeyAuth(deps.adminKey);

  /** admin 路由公共选项：admin-key 鉴权 + admin tag + security。 */
  const admin = (summary: string, operationId: string, extra: Record<string, unknown> = {}) => ({
    preHandler: requireAdmin,
    schema: { tags: [TAG], summary, operationId, security: REQUIRE_ADMIN, ...extra },
  });

  // Posts
  app.post<{ Body: { authorId: number; content: string; createdAt?: number; replyToId?: number; quoteOfId?: number } }>(
    '/api/admin/posts',
    admin('代理发帖（可建历史/回复/引用）', 'createAdminPost', { body: adminPostBodySchema }),
    controller.createPost,
  );
  app.post<{ Body: { pairs: Array<{ followerId: number; followeeId: number }> } }>(
    '/api/admin/follows',
    admin('批量关注', 'bulkFollow', { body: bulkFollowBodySchema }),
    controller.bulkFollow,
  );
  app.post<{ Params: { id: string }; Body: { likeCount?: number; repostCount?: number; replyCount?: number; viewCount?: number } }>(
    '/api/admin/posts/:id/counts',
    admin('计数注水', 'updatePostCounts', { params: idParamsSchema, body: updateCountsBodySchema }),
    controller.updateCounts,
  );
  app.post<{ Body: { posts?: Array<{ authorId: number; content: string; createdAt?: number; replyToId?: number }>; follows?: Array<{ followerId: number; followeeId: number }>; counts?: Array<{ postId: number; likeCount?: number; repostCount?: number; viewCount?: number }> } }>(
    '/api/admin/import',
    admin('批量导入（帖/关注/计数）', 'bulkImport', { body: bulkImportBodySchema }),
    controller.bulkImport,
  );

  // Lore
  app.get('/api/admin/lore', admin('列设定文档', 'listLore'), controller.listLore);
  app.get<{ Params: { filename: string } }>(
    '/api/admin/lore/:filename',
    admin('读设定文档', 'readLore', { params: filenameParamsSchema }),
    controller.readLore,
  );
  app.put<{ Params: { filename: string }; Body: { content: string } }>(
    '/api/admin/lore/:filename',
    admin('写设定文档', 'writeLore', { params: filenameParamsSchema, body: writeLoreBodySchema }),
    controller.writeLore,
  );
  app.delete<{ Params: { filename: string } }>(
    '/api/admin/lore/:filename',
    admin('删设定文档', 'deleteLore', { params: filenameParamsSchema }),
    controller.deleteLore,
  );

  // NPC profiles
  app.get('/api/admin/npc-profiles', admin('列 NPC 档案', 'listNpcProfiles'), controller.listNpcProfiles);
  app.get<{ Params: { userId: string } }>(
    '/api/admin/npc-profiles/:userId',
    admin('读某账号 NPC 档案', 'getNpcProfile', { params: userIdParamsSchema }),
    controller.getNpcProfile,
  );
  app.put<{ Params: { userId: string }; Body: Record<string, unknown> }>(
    '/api/admin/npc-profiles/:userId',
    admin('写某账号 NPC 档案', 'upsertNpcProfile', { params: userIdParamsSchema, body: freeformObjectBodySchema }),
    controller.upsertNpcProfile,
  );
  app.delete<{ Params: { userId: string } }>(
    '/api/admin/npc-profiles/:userId',
    admin('删某账号 NPC 档案', 'deleteNpcProfile', { params: userIdParamsSchema }),
    controller.deleteNpcProfile,
  );

  // Topics
  app.get('/api/admin/topics', admin('列话题', 'listTopics'), controller.listTopics);
  app.post<{ Body: { title: string; description?: string; heat?: number; tags?: string[] } }>(
    '/api/admin/topics',
    admin('建话题', 'createTopic', { body: createTopicBodySchema }),
    controller.createTopic,
  );
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/admin/topics/:id',
    admin('改话题', 'updateTopic', { params: idParamsSchema, body: freeformObjectBodySchema }),
    controller.updateTopic,
  );
  app.delete<{ Params: { id: string } }>(
    '/api/admin/topics/:id',
    admin('删话题', 'deleteTopic', { params: idParamsSchema }),
    controller.deleteTopic,
  );

  // Content Pools
  app.get('/api/admin/content-pools', admin('读内容池（扁平 string[]）', 'getContentPools'), controller.getContentPools);
  app.post<{ Body: { poolType: string; key: string; items: string[] } }>(
    '/api/admin/content-pools',
    admin('内容池增条目', 'addToContentPool', { body: addToPoolBodySchema }),
    controller.addToPool,
  );
  app.delete<{ Params: { poolType: string; key: string } }>(
    '/api/admin/content-pools/:poolType/:key',
    admin('清某内容池', 'clearContentPool', { params: poolParamsSchema }),
    controller.clearPool,
  );

  // Users
  app.get('/api/admin/users', admin('列账号', 'listAdminUsers'), controller.listUsers);
  app.post<{ Body: { handle: string; displayName: string; password?: string } }>(
    '/api/admin/users',
    admin('代理建号（设 is_bot=1）', 'createAdminUser', { body: createUserBodySchema }),
    controller.createUser,
  );

  // Login-as: 凭 admin key 为某账号换一张登录票，供模拟器驱动（不存明文密码）
  app.post<{ Body: { userId: number } }>(
    '/api/admin/login-as',
    admin('代登录票据（供模拟器驱动）', 'loginAs', { body: loginAsBodySchema }),
    controller.loginAs,
  );

  // LLM config
  app.get('/api/admin/llm-config', admin('读 LLM 配置', 'getLlmConfig'), controller.getLlmConfig);
  app.put<{ Body: Record<string, unknown> }>(
    '/api/admin/llm-config',
    admin('存 LLM 配置', 'saveLlmConfig', { body: freeformObjectBodySchema }),
    controller.saveLlmConfig,
  );
  app.post<{ Body: { source: string; apiKey: string; baseUrl?: string } }>(
    '/api/admin/llm-config/fetch-models',
    admin('拉模型列表', 'fetchLlmModels', { body: fetchModelsBodySchema }),
    controller.fetchModels,
  );

  // Agent 手动触发（执行记录归模拟器写入 sim-trace.db，server 不留日志存储）
  app.post<{ Body: { prompt: string } }>(
    '/api/admin/run-agent',
    admin('拉起 Agent 执行', 'runAgent', { body: runAgentBodySchema }),
    controller.runAgent,
  );

  // Simulator status (no auth — editor polls GET, simulator posts heartbeat; localhost infra)
  app.get(
    '/api/simulator/status',
    { schema: { tags: ['simulator'], summary: '模拟器状态（编辑器轮询）', operationId: 'getSimulatorStatus' } },
    controller.simulatorStatus,
  );
  app.post<{ Body: { boundWorldId: string | null; accountCount: number; tickNumber: number; lastFlushedWorldId: string | null; lastFlushAt: number | null } }>(
    '/api/simulator/heartbeat',
    {
      schema: {
        tags: ['simulator'],
        summary: '模拟器上报心跳（每 loop）',
        operationId: 'postSimulatorHeartbeat',
        body: heartbeatBodySchema,
      },
    },
    controller.simulatorHeartbeat,
  );
}

function makeAdminKeyAuth(adminKey: string): preHandlerHookHandler {
  return async function requireAdminKey(req: FastifyRequest) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing admin authorization');
    }
    const token = auth.slice(7);
    if (token !== adminKey) {
      throw new UnauthorizedError('Invalid admin key');
    }
  };
}
