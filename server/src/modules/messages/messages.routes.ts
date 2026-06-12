import { MESSAGE_REACTION_EMOJIS } from '@socialsim/shared';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { AuthTokenPayload } from '../../core/auth/auth-guard.js';
import { UnauthorizedError } from '../../core/errors/app-error.js';
import type { SseHub } from '../../core/events/sse-hub.js';
import type { WorldManager } from '../../core/world/world-manager.js';
import { MessagesController } from './messages.controller.js';
import type { MessagesService } from './messages.service.js';

const idParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer' } },
} as const;

const messageIdParamsSchema = {
  type: 'object',
  required: ['messageId'],
  properties: { messageId: { type: 'integer' } },
} as const;

const listConversationsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    filter: { type: 'string', enum: ['inbox', 'requests'] },
    cursor: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
  },
} as const;

const pageQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cursor: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
  },
} as const;

const createConversationBodySchema = {
  type: 'object',
  required: ['userId'],
  additionalProperties: false,
  properties: { userId: { type: 'integer' } },
} as const;

const sendMessageBodySchema = {
  type: 'object',
  required: ['content'],
  additionalProperties: false,
  properties: {
    content: { type: 'string', maxLength: 1000 },
    mediaIds: { type: 'array', items: { type: 'integer' }, maxItems: 4 },
  },
} as const;

const markReadBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: { messageId: { type: 'integer' } },
} as const;

const reactionBodySchema = {
  type: 'object',
  required: ['emoji'],
  additionalProperties: false,
  properties: { emoji: { type: 'string', enum: [...MESSAGE_REACTION_EMOJIS] } },
} as const;

const streamQuerySchema = {
  type: 'object',
  required: ['token'],
  additionalProperties: false,
  properties: { token: { type: 'string' } },
} as const;

export interface MessagesRoutesDeps {
  messagesService: MessagesService;
  sseHub: SseHub;
  worldManager: WorldManager;
  requireAuth: preHandlerHookHandler;
}

export function registerMessagesRoutes(app: FastifyInstance, deps: MessagesRoutesDeps): void {
  const controller = new MessagesController(deps.messagesService);
  const auth = { preHandler: deps.requireAuth };

  app.post<{ Body: { userId: number } }>(
    '/api/messages/conversations',
    { ...auth, schema: { body: createConversationBodySchema } },
    controller.createConversation,
  );
  app.get<{ Querystring: { filter?: 'inbox' | 'requests'; cursor?: string; limit?: number } }>(
    '/api/messages/conversations',
    { ...auth, schema: { querystring: listConversationsQuerySchema } },
    controller.listConversations,
  );
  app.get('/api/messages/unread-count', auth, controller.unreadCount);
  app.get<{ Params: { id: number } }>(
    '/api/messages/conversations/:id',
    { ...auth, schema: { params: idParamsSchema } },
    controller.getConversation,
  );
  app.get<{ Params: { id: number }; Querystring: { cursor?: string; limit?: number } }>(
    '/api/messages/conversations/:id/messages',
    { ...auth, schema: { params: idParamsSchema, querystring: pageQuerySchema } },
    controller.listMessages,
  );
  app.post<{ Params: { id: number }; Body: { content: string; mediaIds?: number[] } }>(
    '/api/messages/conversations/:id/messages',
    { ...auth, schema: { params: idParamsSchema, body: sendMessageBodySchema } },
    controller.sendMessage,
  );
  app.post<{ Params: { id: number }; Body: { messageId?: number } }>(
    '/api/messages/conversations/:id/read',
    { ...auth, schema: { params: idParamsSchema, body: markReadBodySchema } },
    controller.markRead,
  );
  app.post<{ Params: { id: number } }>(
    '/api/messages/conversations/:id/accept',
    { ...auth, schema: { params: idParamsSchema } },
    controller.acceptRequest,
  );
  app.delete<{ Params: { id: number } }>(
    '/api/messages/conversations/:id',
    { ...auth, schema: { params: idParamsSchema } },
    controller.hideConversation,
  );
  app.delete<{ Params: { messageId: number } }>(
    '/api/messages/:messageId',
    { ...auth, schema: { params: messageIdParamsSchema } },
    controller.deleteMessage,
  );
  app.put<{ Params: { messageId: number }; Body: { emoji: string } }>(
    '/api/messages/:messageId/reaction',
    { ...auth, schema: { params: messageIdParamsSchema, body: reactionBodySchema } },
    controller.setReaction,
  );
  app.delete<{ Params: { messageId: number } }>(
    '/api/messages/:messageId/reaction',
    { ...auth, schema: { params: messageIdParamsSchema } },
    controller.removeReaction,
  );

  // SSE 实时流。EventSource 带不了 Authorization 头，token 走 query 手动验证；
  // hijack 后自管原始连接生命周期（规避 async handler 与流式响应的竞争）
  app.get<{ Querystring: { token: string } }>(
    '/api/messages/stream',
    { schema: { querystring: streamQuerySchema } },
    (req, reply) => {
      let payload: AuthTokenPayload;
      try {
        payload = app.jwt.verify<AuthTokenPayload>(req.query.token);
      } catch {
        throw new UnauthorizedError('未登录或登录已过期');
      }
      if (payload.worldId !== deps.worldManager.current().worldId) {
        throw new UnauthorizedError('登录态属于另一个世界，请重新登录');
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      reply.raw.write(': connected\n\n');
      const unregister = deps.sseHub.addClient(payload.sub, payload.worldId, reply.raw);
      req.raw.on('close', unregister);
    },
  );
}
