import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { SearchController } from './search.controller.js';
import type { SearchService } from './search.service.js';

const searchQuerySchema = {
  type: 'object',
  required: ['q'],
  additionalProperties: false,
  properties: {
    q: { type: 'string', minLength: 1, maxLength: 100 },
    cursor: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
  },
} as const;

export interface SearchRoutesDeps {
  searchService: SearchService;
  optionalAuth: preHandlerHookHandler;
}

export function registerSearchRoutes(app: FastifyInstance, deps: SearchRoutesDeps): void {
  const controller = new SearchController(deps.searchService);
  const opts = { preHandler: deps.optionalAuth, schema: { querystring: searchQuerySchema } };

  app.get<{ Querystring: { q: string; cursor?: string; limit?: number } }>(
    '/api/search/posts',
    opts,
    controller.posts,
  );
  app.get<{ Querystring: { q: string; cursor?: string; limit?: number } }>(
    '/api/search/users',
    opts,
    controller.users,
  );
}
