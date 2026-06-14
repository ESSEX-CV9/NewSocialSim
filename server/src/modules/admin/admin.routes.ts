import type { FastifyInstance, FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { AdminController } from './admin.controller.js';
import type { AdminService } from './admin.service.js';
import { UnauthorizedError } from '../../core/errors/app-error.js';

export interface AdminRoutesDeps {
  adminService: AdminService;
  adminKey: string;
}

export function registerAdminRoutes(app: FastifyInstance, deps: AdminRoutesDeps): void {
  const controller = new AdminController(deps.adminService);
  const requireAdmin = makeAdminKeyAuth(deps.adminKey);

  app.post<{
    Body: {
      authorId: number;
      content: string;
      createdAt?: number;
      replyToId?: number;
      quoteOfId?: number;
    };
  }>('/api/admin/posts', { preHandler: requireAdmin }, controller.createPost);

  app.post<{
    Body: { pairs: Array<{ followerId: number; followeeId: number }> };
  }>('/api/admin/follows', { preHandler: requireAdmin }, controller.bulkFollow);

  app.post<{
    Params: { id: string };
    Body: {
      likeCount?: number;
      repostCount?: number;
      replyCount?: number;
      viewCount?: number;
    };
  }>('/api/admin/posts/:id/counts', { preHandler: requireAdmin }, controller.updateCounts);

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
