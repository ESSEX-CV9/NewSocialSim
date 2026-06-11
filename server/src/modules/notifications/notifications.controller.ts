import type { FastifyReply, FastifyRequest } from 'fastify';
import type { NotificationsService } from './notifications.service.js';

export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  list = async (
    req: FastifyRequest<{ Querystring: { cursor?: string; limit?: number } }>,
    reply: FastifyReply,
  ) => {
    reply.send(this.service.list(req.user.sub, req.query.cursor, req.query.limit));
  };

  unreadCount = async (req: FastifyRequest, reply: FastifyReply) => {
    reply.send({ count: this.service.unreadCount(req.user.sub) });
  };

  markAllRead = async (req: FastifyRequest, reply: FastifyReply) => {
    this.service.markAllRead(req.user.sub);
    reply.status(204).send();
  };
}
