import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AdminService } from './admin.service.js';
import type { LoreService } from './lore.service.js';
import type { NpcService, NpcProfile } from './npc.service.js';

export class AdminController {
  constructor(
    private readonly service: AdminService,
    private readonly lore: LoreService,
    private readonly npc: NpcService,
  ) {}

  // --- Posts ---

  createPost = async (
    req: FastifyRequest<{
      Body: { authorId: number; content: string; createdAt?: number; replyToId?: number; quoteOfId?: number };
    }>,
    reply: FastifyReply,
  ) => {
    const result = await this.service.createPost(req.body);
    reply.status(201).send(result);
  };

  bulkFollow = async (
    req: FastifyRequest<{
      Body: { pairs: Array<{ followerId: number; followeeId: number }> };
    }>,
    reply: FastifyReply,
  ) => {
    reply.send(this.service.bulkFollow(req.body.pairs));
  };

  updateCounts = async (
    req: FastifyRequest<{
      Params: { id: string };
      Body: { likeCount?: number; repostCount?: number; replyCount?: number; viewCount?: number };
    }>,
    reply: FastifyReply,
  ) => {
    this.service.updateCounts(Number(req.params.id), req.body);
    reply.send({ ok: true });
  };

  bulkImport = async (
    req: FastifyRequest<{
      Body: {
        posts?: Array<{ authorId: number; content: string; createdAt?: number; replyToId?: number }>;
        follows?: Array<{ followerId: number; followeeId: number }>;
        counts?: Array<{ postId: number; likeCount?: number; repostCount?: number; viewCount?: number }>;
      };
    }>,
    reply: FastifyReply,
  ) => {
    const result = await this.service.bulkImport(req.body);
    reply.status(201).send(result);
  };

  // --- Lore ---

  listLore = async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send(this.lore.list());
  };

  readLore = async (req: FastifyRequest<{ Params: { filename: string } }>, reply: FastifyReply) => {
    reply.send(this.lore.read(req.params.filename));
  };

  writeLore = async (
    req: FastifyRequest<{ Params: { filename: string }; Body: { content: string } }>,
    reply: FastifyReply,
  ) => {
    this.lore.write(req.params.filename, req.body.content);
    reply.send({ ok: true });
  };

  deleteLore = async (req: FastifyRequest<{ Params: { filename: string } }>, reply: FastifyReply) => {
    this.lore.remove(req.params.filename);
    reply.status(204).send();
  };

  // --- NPC Profiles ---

  listNpcProfiles = async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send({ profiles: this.npc.list() });
  };

  getNpcProfile = async (req: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
    reply.send(this.npc.get(Number(req.params.userId)));
  };

  upsertNpcProfile = async (
    req: FastifyRequest<{ Params: { userId: string }; Body: Record<string, unknown> }>,
    reply: FastifyReply,
  ) => {
    const profile = this.npc.upsert({ ...req.body, userId: Number(req.params.userId) } as NpcProfile);
    reply.send(profile);
  };

  deleteNpcProfile = async (req: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
    this.npc.remove(Number(req.params.userId));
    reply.status(204).send();
  };

  // --- Topics ---

  listTopics = async (req: FastifyRequest, reply: FastifyReply) => {
    const activeOnly = (req.query as Record<string, string>).active === 'true';
    reply.send({ topics: this.service.listTopics(activeOnly) });
  };

  createTopic = async (
    req: FastifyRequest<{ Body: { title: string; description?: string; heat?: number; tags?: string[] } }>,
    reply: FastifyReply,
  ) => {
    const topic = this.service.createTopic(req.body);
    reply.status(201).send(topic);
  };

  updateTopic = async (
    req: FastifyRequest<{ Params: { id: string }; Body: Record<string, unknown> }>,
    reply: FastifyReply,
  ) => {
    const topic = this.service.updateTopic(Number(req.params.id), req.body as any);
    reply.send(topic);
  };

  deleteTopic = async (
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    this.service.deleteTopic(Number(req.params.id));
    reply.status(204).send();
  };

  // --- Content Pools ---

  getContentPools = async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send(this.service.getContentPools());
  };

  addToPool = async (
    req: FastifyRequest<{ Body: { poolType: string; key: string; items: string[] } }>,
    reply: FastifyReply,
  ) => {
    this.service.addToPool(req.body.poolType as 'scene' | 'topic', req.body.key, req.body.items);
    reply.send({ ok: true });
  };

  clearPool = async (
    req: FastifyRequest<{ Params: { poolType: string; key: string } }>,
    reply: FastifyReply,
  ) => {
    this.service.clearPool(req.params.poolType as 'scene' | 'topic', req.params.key);
    reply.status(204).send();
  };

  // --- Users ---

  listUsers = async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send({ users: this.service.listUsers() });
  };

  createUser = async (
    req: FastifyRequest<{ Body: { handle: string; displayName: string; password?: string } }>,
    reply: FastifyReply,
  ) => {
    reply.status(201).send(this.service.createBotUser(req.body));
  };

  loginAs = async (
    req: FastifyRequest<{ Body: { userId: number } }>,
    reply: FastifyReply,
  ) => {
    const claims = this.service.loginClaims(req.body.userId);
    const token = await reply.jwtSign(
      { sub: claims.sub, worldId: claims.worldId, handle: claims.handle },
      { expiresIn: '30d' },
    );
    reply.send({ token, userId: claims.sub, handle: claims.handle, displayName: claims.displayName });
  };

  // --- LLM Config ---

  getLlmConfig = async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send(this.service.getLlmConfig());
  };

  saveLlmConfig = async (
    req: FastifyRequest<{ Body: Record<string, unknown> }>,
    reply: FastifyReply,
  ) => {
    this.service.saveLlmConfig(req.body as any);
    reply.send({ ok: true });
  };

  fetchModels = async (
    req: FastifyRequest<{ Body: { source: string; apiKey: string; baseUrl?: string } }>,
    reply: FastifyReply,
  ) => {
    const models = await this.service.fetchModels(req.body.source, req.body.apiKey, req.body.baseUrl);
    reply.send({ models });
  };

  // --- Agent ---

  runAgent = async (
    req: FastifyRequest<{ Body: { prompt: string } }>,
    reply: FastifyReply,
  ) => {
    const result = await this.service.runAgent(req.body.prompt);
    reply.send(result);
  };

  // --- Simulator ---

  simulatorStatus = async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send(this.service.getSimulatorStatus());
  };
}
