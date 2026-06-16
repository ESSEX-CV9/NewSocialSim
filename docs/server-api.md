# Server HTTP API 速查

社交站后端（`server/`，Fastify，默认 `http://127.0.0.1:3000`）的全部 HTTP 端点。**API 优先**——第二阶段模拟器、编辑器后端、验收脚本都只能经这些端点操作世界。本文件是能力清单与鉴权速查；字段细节以 `shared/src/types/` 与各模块 `*.routes.ts` 的 schema 为准。

> 维护：新增/改动端点时同步本文件（路径、方法、鉴权、用途）。路由真相源是 `server/src/modules/*/*.routes.ts`。

## 鉴权方案

| 标记 | 含义 | 怎么带 |
|---|---|---|
| **公开** | 无需任何凭证 | 直接请求 |
| **JWT** | 登录用户（`requireAuth`） | `Authorization: Bearer <jwt>`；JWT 含 `worldId`，切世界后旧 token 全 401 |
| **JWT?** | 可选登录（`optionalAuth`） | 带 JWT 则有观察者态（如 likedByViewer），不带也可读 |
| **admin-key** | 管理端（`requireAdmin`） | `Authorization: Bearer <adminKey>`（默认 `dev-admin-key`，env `SOCIALSIM_ADMIN_KEY`） |
| **SSE-token** | EventSource 流 | token 走 query（`?token=<jwt>`），EventSource 带不了 header |

> ⚠️ **世界管理端点 `/api/admin/worlds*` 当前无鉴权**（路由未挂 preHandler）。模拟器/编辑器/脚本习惯上仍带 admin-key，但服务端未强制——后续若收紧需加守卫。

## 通用约定

- **游标分页**：列表响应 `{ items, nextCursor }`，`nextCursor` 为 base64url(JSON 数组)，对客户端不透明；`limit` 多数上限 50。
- **虚拟时间**：所有时间字段为世界模拟时间（unix 毫秒形态），来自活动世界时钟，非系统时间。
- **多世界**：任一时刻只有一个活动世界；读写默认作用于活动世界。切世界经 `POST /api/admin/worlds/:id/activate`。
- **错误形态**：`{ statusCode, error, message }`（Fastify 默认）。

---

## 认证 `auth`

| 方法 | 路径 | 鉴权 | 用途 |
|---|---|---|---|
| POST | `/api/auth/register` | 公开 | 注册（真人；不承担批量建号，那走管理端代理建号） |
| POST | `/api/auth/login` | 公开 | 登录，换 JWT |
| GET | `/api/auth/me` | JWT | 当前登录用户 |

## 世界管理 `worlds`（路径在 /api/admin 下，但当前无鉴权——见上注）

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/admin/worlds` | 列出所有世界 |
| POST | `/api/admin/worlds` | 创建世界（body：id/name/locale/contentRating/clock/calendar） |
| GET | `/api/admin/worlds/active` | 当前活动世界 + 当前模拟时间（`{ meta, simTimeMs }`） |
| POST | `/api/admin/worlds/:id/activate` | 激活（切换）世界 |
| PATCH | `/api/admin/worlds/:id` | 改世界元数据 |
| POST | `/api/admin/worlds/clock` | 时钟控制（pause/resume/setScale/setTime） |
| POST | `/api/admin/worlds/:id/copy` | 复制世界（body：newId） |
| DELETE | `/api/admin/worlds/:id` | 删除世界 |
| POST | `/api/admin/worlds/snapshots` | 对活动世界建快照 |
| GET | `/api/admin/worlds/:id/snapshots` | 列快照 |
| POST | `/api/admin/worlds/:id/snapshots/:name/restore` | 恢复快照 |
| DELETE | `/api/admin/worlds/:id/snapshots/:name` | 删快照 |

## 账号 `users`

| 方法 | 路径 | 鉴权 | 用途 |
|---|---|---|---|
| GET | `/api/users/suggested` | JWT? | 推荐关注 |
| GET | `/api/users/:handle` | JWT? | 账号资料（含 displayName/计数/观察者关注态） |
| PATCH | `/api/users/me` | JWT | 改本人资料 |

## 帖子 `posts`

| 方法 | 路径 | 鉴权 | 用途 |
|---|---|---|---|
| POST | `/api/posts` | JWT | 发帖（body：content/replyToId/quoteOfId/mediaIds…） |
| GET | `/api/posts/:id` | JWT? | 单帖详情（删除返墓碑） |
| GET | `/api/posts/:id/replies` | JWT? | 某帖的回复（游标分页） |
| GET | `/api/users/:handle/posts` | JWT? | 某账号的帖（`?type=posts\|replies`，游标分页）——顶层帖含引用 |
| GET | `/api/users/:handle/likes` | JWT? | 某账号点赞过的帖（注意：返回帖本身，**不含点赞时间**，时间见互动事件流） |
| GET | `/api/users/:handle/media` | JWT? | 某账号的含媒体帖 |
| DELETE | `/api/posts/:id` | JWT | 删帖（仅本人） |
| POST/DELETE | `/api/posts/:id/pin` | JWT | 置顶/取消置顶（每人一条） |
| POST | `/api/posts/views` | JWT? | 曝光计数上报（body：ids；匿名也计） |

## 时间线 `timeline`

| 方法 | 路径 | 鉴权 | 用途 |
|---|---|---|---|
| GET | `/api/timeline/home` | JWT | 关注流（`?sort=latest\|hot`） |
| GET | `/api/timeline/foryou` | JWT? | 推荐流 |
| GET | `/api/timeline/global` | JWT? | **全站流（firehose）**：所有账号的顶层帖按时间，`TimelineItem{type,post,repostedBy,activityAt}`——**仅顶层帖**，不含回复 |
| GET | `/api/users/:handle/timeline` | JWT? | 某账号主页流（含其帖与转发） |

## 互动 `interactions`

| 方法 | 路径 | 鉴权 | 用途 |
|---|---|---|---|
| POST/DELETE | `/api/posts/:id/like` | JWT | 赞/取消赞 |
| POST/DELETE | `/api/posts/:id/repost` | JWT | 转/取消转 |
| POST/DELETE | `/api/posts/:id/bookmark` | JWT | 收藏/取消（私密） |
| POST/DELETE | `/api/posts/:id/hide` | JWT | 隐藏/取消隐藏（"不感兴趣"） |
| GET | `/api/bookmarks` | JWT | 本人收藏列表 |
| GET | `/api/users/:handle/interactions` | JWT? | **某账号互动事件流**（赞/转/关注，带发生时间 `at`，游标分页）——时间轴互动块来源 |

## 关注 / 屏蔽 `follows` / `blocks`

| 方法 | 路径 | 鉴权 | 用途 |
|---|---|---|---|
| POST/DELETE | `/api/users/:handle/follow` | JWT | 关注/取关 |
| GET | `/api/users/:handle/followers` | 公开 | 粉丝列表 |
| GET | `/api/users/:handle/following` | 公开 | 关注列表 |
| POST/DELETE | `/api/users/:handle/block` | JWT | 屏蔽/取消屏蔽 |

## 通知 `notifications`

| 方法 | 路径 | 鉴权 | 用途 |
|---|---|---|---|
| GET | `/api/notifications` | JWT | 通知列表（`?filter=all\|mentions`） |
| GET | `/api/notifications/unread-count` | JWT | 未读数 |
| POST | `/api/notifications/read-all` | JWT | 全部已读 |
| POST | `/api/notifications/read` | JWT | 标记部分已读（body：ids） |

## 私信 `messages`

| 方法 | 路径 | 鉴权 | 用途 |
|---|---|---|---|
| POST | `/api/messages/conversations` | JWT | 发起会话（body：userId） |
| GET | `/api/messages/conversations` | JWT | 会话列表（`?filter=inbox\|unread\|requests\|hidden`） |
| GET | `/api/messages/conversations/:id` | JWT | 单会话 |
| DELETE | `/api/messages/conversations/:id` | JWT | 隐藏会话 |
| GET | `/api/messages/conversations/:id/messages` | JWT | 会话消息（游标分页） |
| POST | `/api/messages/conversations/:id/messages` | JWT | 发消息（body：content/mediaIds≤4） |
| POST | `/api/messages/conversations/:id/read` | JWT | 标已读（body：messageId） |
| POST | `/api/messages/conversations/:id/unread` | JWT | 标未读 |
| POST | `/api/messages/conversations/:id/accept` | JWT | 接受消息请求 |
| POST/DELETE | `/api/messages/conversations/:id/mute` | JWT | 免打扰开/关 |
| POST/DELETE | `/api/messages/conversations/:id/pin` | JWT | 置顶开/关 |
| GET | `/api/messages/unread-count` | JWT | 私信总未读 |
| POST | `/api/messages/read-all` | JWT | 全部已读 |
| GET | `/api/messages/search` | JWT | 搜会话/消息（`?q=`） |
| DELETE | `/api/messages/:messageId` | JWT | 删消息 |
| PUT/DELETE | `/api/messages/:messageId/reaction` | JWT | 表情回应 设/删（body：emoji） |
| GET | `/api/messages/stream` | SSE-token | 私信实时流（SSE，`?token=<jwt>`） |

## 搜索 `search`

| 方法 | 路径 | 鉴权 | 用途 |
|---|---|---|---|
| GET | `/api/search/posts` | JWT? | 搜帖（`?q=`） |
| GET | `/api/search/users` | JWT? | 搜账号（`?q=`） |
| GET | `/api/search/trends` | 公开 | 趋势（`?limit=`） |

## 媒体 `media`

| 方法 | 路径 | 鉴权 | 用途 |
|---|---|---|---|
| POST | `/api/media/upload` | JWT | 上传媒体文件 |
| POST | `/api/media/from-url` | JWT | 外链下载入库（body：url/source）——虚拟用户配图链路一环 |
| GET | `/api/media/:id/file` | 公开 | 媒体文件流（`?w=<worldId>` 防跨世界缓存撞号；`<img>`/`<video>` 用） |
| GET | `/api/media/:id/stream` | 公开 | 流式视频代理（`?w=`；由 video-search 模块注册） |

## 搜图 `media-search`（实例级配置在 data/media-search.json）

| 方法 | 路径 | 鉴权 | 用途 |
|---|---|---|---|
| GET | `/api/media-search` | JWT | 关键字搜图（`?q=&source=&rating=`）——配图链路第一环 |
| GET | `/api/media-search/sources` | JWT | 可用图源 |
| GET | `/api/media-search/preview` | 公开 | 外链预览代理（`?url=`，白名单在 service） |
| GET/PATCH | `/api/media-search/config` | JWT | 读/改搜图配置（代理/各源 key/视频策略等） |
| POST | `/api/media-search/pixiv/login` + `/pixiv/code` | JWT | Pixiv CDP 引导登录 / 提交 code |
| GET | `/api/media-search/pixiv/login/status` | JWT | Pixiv 登录态 |
| POST | `/api/media-search/bilibili/login` | JWT | B 站引导登录 |
| GET | `/api/media-search/bilibili/login/status` | JWT | B 站登录态 |

## 视频引入 `video-search`

| 方法 | 路径 | 鉴权 | 用途 |
|---|---|---|---|
| POST | `/api/video/ingest` | JWT | 引入视频（body：url/mode=auto\|download\|stream） |
| GET | `/api/video/sources` | JWT | 视频源 |
| GET | `/api/video/search` | JWT | 搜视频（`?q=&source=`） |
| GET | `/api/video/tasks` | JWT | 异步任务列表 |
| GET/DELETE | `/api/video/tasks/:id` | JWT | 单任务查询/取消 |

## 工具 `tools`（yt-dlp / ffmpeg 二进制管理）

| 方法 | 路径 | 鉴权 | 用途 |
|---|---|---|---|
| GET | `/api/tools/status` | JWT | 二进制安装状态 |
| GET | `/api/tools/latest` | JWT | 最新版本 |
| POST | `/api/tools/:id/install` | JWT | 安装（id=yt-dlp\|ffmpeg） |
| GET | `/api/tools/:id/install/status` | JWT | 安装进度 |

## 管理端 `admin`（全部 admin-key，除模拟器状态）

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/admin/users` | **代理建号**（设 is_bot=1，拒绝 sim_/bot/npc/user\d+ 等命名；返回随机密码） |
| GET | `/api/admin/users` | 列账号（含 isBot） |
| POST | `/api/admin/login-as` | 代登录票据（凭 admin-key 换某账号 JWT，不需密码）——模拟器驱动账号用 |
| POST | `/api/admin/posts` | 代理发帖（可带 createdAt 建历史帖 / replyToId / quoteOfId） |
| POST | `/api/admin/posts/:id/counts` | 计数注水（like/repost/reply/view） |
| POST | `/api/admin/follows` | 批量关注（body：pairs） |
| POST | `/api/admin/import` | 批量导入（posts/follows/counts） |
| GET/POST | `/api/admin/content-pools` | 读/增内容池条目（扁平 string[]，Phase 1 将被三层 ECS 模型取代） |
| DELETE | `/api/admin/content-pools/:poolType/:key` | 清某池 |
| GET | `/api/admin/npc-profiles` | 列 NPC 档案 |
| GET/PUT/DELETE | `/api/admin/npc-profiles/:userId` | 读/写/删某账号 NPC 档案（被驱动账号 = 有档案者） |
| GET/POST | `/api/admin/topics` | 列/建话题 |
| PATCH/DELETE | `/api/admin/topics/:id` | 改/删话题 |
| GET | `/api/admin/lore` | 列设定文档 |
| GET/PUT/DELETE | `/api/admin/lore/:filename` | 读/写/删设定文档 |
| GET/PUT | `/api/admin/llm-config` | 读/存 LLM 多提供商配置 |
| POST | `/api/admin/llm-config/fetch-models` | 拉某提供商模型列表 |
| POST | `/api/admin/run-agent` | 拉起一个 Agent 执行（LLM 行为层 / GM 用） |

## 模拟器状态（公开，供编辑器轮询 / 模拟器上报）

| 方法 | 路径 | 鉴权 | 用途 |
|---|---|---|---|
| GET | `/api/simulator/status` | 公开 | 模拟器状态（绑定世界/账号数/tick/上次 flush；按心跳新鲜度判 running） |
| POST | `/api/simulator/heartbeat` | 公开 | 模拟器上报心跳（模拟器侧每 loop 调） |

---

## 编辑器后端代理（`editor/src/server`，:5176，非社交站）

编辑器 renderer 的唯一数据源；多为转发社交站 + 读模拟器观测库。列此供对照，详见 `editor/src/server/index.ts`。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/health` | 健康检查 |
| GET | `/api/worlds/active` | 转发社交站活动世界 |
| GET | `/api/simulator/status` | 转发模拟器状态 |
| POST | `/api/worlds/clock` | 转发时钟控制 |
| GET | `/api/layouts` · PUT | 读/写该世界编辑器布局（`data/worlds/<id>/editor-layouts.json`） |
| GET | `/api/users/:handle` · `/posts` · `/timeline` · `/interactions` | 转发社交站对应端点（时间轴取数） |
| GET | `/api/timeline/global` | 转发全站流（时间轴主轴） |
| GET | `/api/trace?from&to&entity&limit` | 只读活动世界 `sim-trace.db` 决策轨迹（区间查询） |
| GET | `/api/trace/stream` | 决策轨迹 SSE |
| POST | `/api/trace/ingest` | 模拟器推轨迹入口 → 转发 SSE |
