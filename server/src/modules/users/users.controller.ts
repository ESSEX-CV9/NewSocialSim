import type { UpdateProfileRequest } from '@socialsim/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UsersService } from './users.service.js';

export class UsersController {
  constructor(private readonly service: UsersService) {}

  getByHandle = async (req: FastifyRequest<{ Params: { handle: string } }>, reply: FastifyReply) => {
    reply.send({ user: this.service.getProfileByHandle(req.params.handle) });
  };

  updateMe = async (req: FastifyRequest<{ Body: UpdateProfileRequest }>, reply: FastifyReply) => {
    reply.send({ user: this.service.updateMe(req.user.sub, req.body) });
  };
}
