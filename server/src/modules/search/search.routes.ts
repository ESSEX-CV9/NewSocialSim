import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { OPTIONAL_JWT } from '../../core/openapi/swagger.js';
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

  app.get<{ Querystring: { q: string; cursor?: string; limit?: number } }>(
    '/api/search/posts',
    {
      preHandler: deps.optionalAuth,
      schema: {
        tags: ['search'],
        summary: '搜索帖子',
        operationId: 'searchPosts',
        security: OPTIONAL_JWT,
        querystring: searchQuerySchema,
      },
    },
    controller.posts,
  );
  app.get<{ Querystring: { q: string; cursor?: string; limit?: number } }>(
    '/api/search/users',
    {
      preHandler: deps.optionalAuth,
      schema: {
        tags: ['search'],
        summary: '搜索账号',
        operationId: 'searchUsers',
        security: OPTIONAL_JWT,
        querystring: searchQuerySchema,
      },
    },
    controller.users,
  );
  // 趋势为公开数据（同全站流），无需鉴权
  app.get<{ Querystring: { limit?: number } }>(
    '/api/search/trends',
    {
      schema: {
        tags: ['search'],
        summary: '趋势',
        operationId: 'getTrends',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { limit: { type: 'integer', minimum: 1, maximum: 20 } },
        } as const,
      },
    },
    controller.trends,
  );
}
