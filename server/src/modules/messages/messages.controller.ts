import type { FastifyReply, FastifyRequest } from 'fastify';
import type { MessagesService } from './messages.service.js';

export class MessagesController {
  constructor(private readonly service: MessagesService) {}

  createConversation = async (
    req: FastifyRequest<{ Body: { userId: number } }>,
    reply: FastifyReply,
  ) => {
    reply.send({ conversation: this.service.findOrCreateConversation(req.user.sub, req.body.userId) });
  };

  listConversations = async (
    req: FastifyRequest<{
      Querystring: { filter?: 'inbox' | 'requests'; cursor?: string; limit?: number };
    }>,
    reply: FastifyReply,
  ) => {
    reply.send(
      this.service.listConversations(
        req.user.sub,
        req.query.filter ?? 'inbox',
        req.query.cursor,
        req.query.limit,
      ),
    );
  };

  getConversation = async (
    req: FastifyRequest<{ Params: { id: number } }>,
    reply: FastifyReply,
  ) => {
    reply.send({ conversation: this.service.getConversation(req.user.sub, req.params.id) });
  };

  listMessages = async (
    req: FastifyRequest<{
      Params: { id: number };
      Querystring: { cursor?: string; limit?: number };
    }>,
    reply: FastifyReply,
  ) => {
    reply.send(
      this.service.listMessages(req.user.sub, req.params.id, req.query.cursor, req.query.limit),
    );
  };

  sendMessage = async (
    req: FastifyRequest<{
      Params: { id: number };
      Body: { content: string; mediaIds?: number[] };
    }>,
    reply: FastifyReply,
  ) => {
    reply.send({ message: this.service.sendMessage(req.user.sub, req.params.id, req.body) });
  };

  markRead = async (
    req: FastifyRequest<{ Params: { id: number }; Body: { messageId?: number } }>,
    reply: FastifyReply,
  ) => {
    reply.send(this.service.markRead(req.user.sub, req.params.id, req.body?.messageId));
  };

  acceptRequest = async (
    req: FastifyRequest<{ Params: { id: number } }>,
    reply: FastifyReply,
  ) => {
    reply.send({ conversation: this.service.acceptRequest(req.user.sub, req.params.id) });
  };

  hideConversation = async (
    req: FastifyRequest<{ Params: { id: number } }>,
    reply: FastifyReply,
  ) => {
    this.service.hideConversation(req.user.sub, req.params.id);
    reply.status(204).send();
  };

  deleteMessage = async (
    req: FastifyRequest<{ Params: { messageId: number } }>,
    reply: FastifyReply,
  ) => {
    reply.send({ message: this.service.deleteMessage(req.user.sub, req.params.messageId) });
  };

  setReaction = async (
    req: FastifyRequest<{ Params: { messageId: number }; Body: { emoji: string } }>,
    reply: FastifyReply,
  ) => {
    reply.send({
      reactions: this.service.setReaction(req.user.sub, req.params.messageId, req.body.emoji),
    });
  };

  removeReaction = async (
    req: FastifyRequest<{ Params: { messageId: number } }>,
    reply: FastifyReply,
  ) => {
    reply.send({ reactions: this.service.removeReaction(req.user.sub, req.params.messageId) });
  };

  unreadCount = async (req: FastifyRequest, reply: FastifyReply) => {
    reply.send(this.service.unreadCount(req.user.sub));
  };
}
