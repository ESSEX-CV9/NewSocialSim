import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';

/** 社交站 OpenAPI 文档基座：info / servers / 鉴权方案 / 按域分组的 tag 表。
 *  路由侧只在各自 schema 里挂 tags / summary / security，引用此处定义的 securityScheme 名。 */

const PORT = Number(process.env.PORT ?? 3000);

/** 鉴权方案名——路由 schema 的 `security` 引用这些名字。与 docs/server-api.md「鉴权方案」一一对应。 */
export const SEC = {
  /** 登录用户 JWT（requireAuth）：Authorization: Bearer <jwt> */
  jwt: 'bearerJWT',
  /** 管理端 admin key（requireAdmin）：Authorization: Bearer <adminKey> */
  admin: 'adminKey',
  /** SSE 流 token（EventSource 带不了 header）：?token=<jwt> */
  sse: 'sseToken',
} as const;

/** 路由 `schema.security` 便捷值——值即 OpenAPI security requirement 数组。
 *  公开端点不写 security（无全局 security，缺省即公开）。 */
export const REQUIRE_JWT = [{ [SEC.jwt]: [] }];
export const REQUIRE_ADMIN = [{ [SEC.admin]: [] }];
export const REQUIRE_SSE = [{ [SEC.sse]: [] }];
/** 可选登录（optionalAuth）：不带凭证也可读，带 JWT 有观察者态（likedByViewer 等）。 */
export const OPTIONAL_JWT = [{}, { [SEC.jwt]: [] }];

/** 按模块分组的 tag 表；顺序即 Swagger UI 中的展示顺序。 */
export const TAGS = [
  { name: 'auth', description: '认证：注册 / 登录 / 当前用户' },
  { name: 'users', description: '账号资料与推荐关注' },
  { name: 'posts', description: '帖子：发帖 / 单帖 / 回复 / 账号帖流 / 置顶 / 曝光' },
  { name: 'timeline', description: '时间线：关注流 / 推荐流 / 全站流 / 账号主页流' },
  { name: 'interactions', description: '互动：赞 / 转 / 收藏 / 隐藏 / 互动事件流' },
  { name: 'follows', description: '关注与粉丝列表' },
  { name: 'blocks', description: '屏蔽' },
  { name: 'notifications', description: '通知' },
  { name: 'messages', description: '私信：会话 / 消息 / 已读 / 表情回应 / SSE 流' },
  { name: 'search', description: '搜索：帖 / 账号 / 趋势' },
  { name: 'media', description: '媒体：上传 / 外链入库 / 文件流 / 视频流' },
  { name: 'media-search', description: '搜图：关键字搜图 / 图源 / 配置 / 站点引导登录' },
  { name: 'video-search', description: '视频引入：搜索 / 引入任务' },
  { name: 'tools', description: '工具：yt-dlp / ffmpeg 二进制管理' },
  { name: 'worlds', description: '世界管理：列 / 建 / 激活 / 时钟 / 快照（当前无鉴权）' },
  { name: 'admin', description: '管理端：代理建号 / 代登录 / 代发帖 / 话题 / 内容池 / LLM / NPC 档案 / 设定库' },
  { name: 'simulator', description: '模拟器状态：心跳上报与状态查询（公开）' },
  { name: 'meta', description: '健康检查等元端点' },
] as const;

/** 在路由注册前 await 调用：挂 OpenAPI 文档生成器与 /docs 交互式 UI。
 *  必须 await——同步的 app.get() 会先于 avvio 队列里的插件执行，
 *  唯有先把 swagger 插件加载完（onRoute 钩子挂上），后续路由才会被采集进 spec。 */
export async function registerSwagger(app: FastifyInstance): Promise<void> {
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'NewSocialSim 社交站 API',
        description:
          '本地社交媒体模拟器（仿 X/Twitter）的社交站后端 HTTP API。第二阶段虚拟用户与真人走相同接口——此 spec 即唯一契约面。\n\n' +
          '约定：时间字段均为世界**模拟时间**（unix 毫秒）；列表接口游标分页 `{ items, nextCursor }`，游标 base64url(JSON) 不透明；任一时刻一个活动世界，读写默认作用于活动世界。',
        version: '0.1.0',
      },
      servers: [{ url: `http://127.0.0.1:${PORT}`, description: '本地开发' }],
      components: {
        securitySchemes: {
          [SEC.jwt]: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: '登录用户 JWT。JWT 含 worldId，切世界后旧 token 全部 401。',
          },
          [SEC.admin]: {
            type: 'http',
            scheme: 'bearer',
            description: '管理端 admin key（默认 dev-admin-key，env SOCIALSIM_ADMIN_KEY）。',
          },
          [SEC.sse]: {
            type: 'apiKey',
            in: 'query',
            name: 'token',
            description: 'SSE 流凭证：EventSource 带不了 header，故 JWT 走 ?token= 查询参数。',
          },
        },
      },
      tags: TAGS.map((t) => ({ name: t.name, description: t.description })),
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true, displayRequestDuration: true },
  });

  // 稳定的机器读地址（swagger-ui 自带 /docs/json、/docs/yaml；此处再给一个根级别名）。
  app.get('/openapi.json', { schema: { hide: true } }, () => app.swagger());
}
