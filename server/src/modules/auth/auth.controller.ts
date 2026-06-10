import type { LoginRequest, RegisterRequest, UserProfile } from '@socialsim/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { WorldManager } from '../../core/world/world-manager.js';
import type { AuthService } from './auth.service.js';

export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly worldManager: WorldManager,
  ) {}

  register = async (req: FastifyRequest<{ Body: RegisterRequest }>, reply: FastifyReply) => {
    const user = this.service.register(req.body);
    reply.status(201).send({ token: await this.signToken(reply, user), user });
  };

  login = async (req: FastifyRequest<{ Body: LoginRequest }>, reply: FastifyReply) => {
    const user = this.service.login(req.body);
    reply.send({ token: await this.signToken(reply, user), user });
  };

  me = async (req: FastifyRequest, reply: FastifyReply) => {
    reply.send({ user: this.service.me(req.user.sub) });
  };

  private signToken(reply: FastifyReply, user: UserProfile): Promise<string> {
    return reply.jwtSign(
      { sub: user.id, worldId: this.worldManager.current().worldId, handle: user.handle },
      { expiresIn: '30d' },
    );
  }
}
