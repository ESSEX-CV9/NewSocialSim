import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { AdminController } from './admin.controller.js';
import type { AdminService } from './admin.service.js';
import type { LoreService } from './lore.service.js';
import type { NpcService } from './npc.service.js';
import { UnauthorizedError } from '../../core/errors/app-error.js';

export interface AdminRoutesDeps {
  adminService: AdminService;
  loreService: LoreService;
  npcService: NpcService;
  adminKey: string;
}

export function registerAdminRoutes(app: FastifyInstance, deps: AdminRoutesDeps): void {
  const controller = new AdminController(deps.adminService, deps.loreService, deps.npcService);
  const requireAdmin = makeAdminKeyAuth(deps.adminKey);

  // Posts
  app.post<{ Body: { authorId: number; content: string; createdAt?: number; replyToId?: number; quoteOfId?: number } }>(
    '/api/admin/posts', { preHandler: requireAdmin }, controller.createPost);
  app.post<{ Body: { pairs: Array<{ followerId: number; followeeId: number }> } }>(
    '/api/admin/follows', { preHandler: requireAdmin }, controller.bulkFollow);
  app.post<{ Params: { id: string }; Body: { likeCount?: number; repostCount?: number; replyCount?: number; viewCount?: number } }>(
    '/api/admin/posts/:id/counts', { preHandler: requireAdmin }, controller.updateCounts);
  app.post<{ Body: { posts?: Array<{ authorId: number; content: string; createdAt?: number; replyToId?: number }>; follows?: Array<{ followerId: number; followeeId: number }>; counts?: Array<{ postId: number; likeCount?: number; repostCount?: number; viewCount?: number }> } }>(
    '/api/admin/import', { preHandler: requireAdmin }, controller.bulkImport);

  // Lore
  app.get('/api/admin/lore', { preHandler: requireAdmin }, controller.listLore);
  app.get<{ Params: { filename: string } }>(
    '/api/admin/lore/:filename', { preHandler: requireAdmin }, controller.readLore);
  app.put<{ Params: { filename: string }; Body: { content: string } }>(
    '/api/admin/lore/:filename', { preHandler: requireAdmin }, controller.writeLore);
  app.delete<{ Params: { filename: string } }>(
    '/api/admin/lore/:filename', { preHandler: requireAdmin }, controller.deleteLore);

  // NPC profiles
  app.get('/api/admin/npc-profiles', { preHandler: requireAdmin }, controller.listNpcProfiles);
  app.get<{ Params: { userId: string } }>(
    '/api/admin/npc-profiles/:userId', { preHandler: requireAdmin }, controller.getNpcProfile);
  app.put<{ Params: { userId: string }; Body: Record<string, unknown> }>(
    '/api/admin/npc-profiles/:userId', { preHandler: requireAdmin }, controller.upsertNpcProfile);
  app.delete<{ Params: { userId: string } }>(
    '/api/admin/npc-profiles/:userId', { preHandler: requireAdmin }, controller.deleteNpcProfile);

  // Topics
  app.get('/api/admin/topics', { preHandler: requireAdmin }, controller.listTopics);
  app.post<{ Body: { title: string; description?: string; heat?: number; tags?: string[] } }>(
    '/api/admin/topics', { preHandler: requireAdmin }, controller.createTopic);
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/admin/topics/:id', { preHandler: requireAdmin }, controller.updateTopic);
  app.delete<{ Params: { id: string } }>(
    '/api/admin/topics/:id', { preHandler: requireAdmin }, controller.deleteTopic);

  // Content Pools
  app.get('/api/admin/content-pools', { preHandler: requireAdmin }, controller.getContentPools);
  app.post<{ Body: { poolType: string; key: string; items: string[] } }>(
    '/api/admin/content-pools', { preHandler: requireAdmin }, controller.addToPool);
  app.delete<{ Params: { poolType: string; key: string } }>(
    '/api/admin/content-pools/:poolType/:key', { preHandler: requireAdmin }, controller.clearPool);

  // Users
  app.get('/api/admin/users', { preHandler: requireAdmin }, controller.listUsers);
  app.post<{ Body: { handle: string; displayName: string; password?: string } }>(
    '/api/admin/users', { preHandler: requireAdmin }, controller.createUser);

  // LLM config
  app.get('/api/admin/llm-config', { preHandler: requireAdmin }, controller.getLlmConfig);
  app.put<{ Body: Record<string, unknown> }>(
    '/api/admin/llm-config', { preHandler: requireAdmin }, controller.saveLlmConfig);
  app.post<{ Body: { source: string; apiKey: string; baseUrl?: string } }>(
    '/api/admin/llm-config/fetch-models', { preHandler: requireAdmin }, controller.fetchModels);

  // Agent logs & manual trigger
  app.get('/api/admin/agent-logs', { preHandler: requireAdmin }, controller.getAgentLogs);
  app.post<{ Body: { taskLabel: string; steps: number; tokens: { input: number; output: number }; log: any[] } }>(
    '/api/admin/agent-logs', { preHandler: requireAdmin }, controller.postAgentLog);
  app.post<{ Body: { prompt: string } }>(
    '/api/admin/run-agent', { preHandler: requireAdmin }, controller.runAgent);

  // Simulator status (no auth required for editor polling)
  app.get('/api/simulator/status', controller.simulatorStatus);
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
