# Server HTTP API 参考

社交站后端（`server/`，Fastify，默认 `http://127.0.0.1:3000`）的全部 HTTP 端点，含请求参数与响应形态。**API 优先**——模拟器、编辑器后端、验收脚本都只能经这些端点操作世界。

> **本文件是人类速查；机器可读契约见 OpenAPI**：起后端后访问 `http://127.0.0.1:3000/docs`（交互式 Swagger UI）/ `GET /openapi.json`，或查仓库内 `docs/openapi/server.{json,yaml}`。生成与设计说明见 `docs/openapi/README.md`。改路由后跑 `npm run gen:openapi -w @socialsim/server` 刷新快照。
>
> 真相源：路由与 schema 见 `server/src/modules/*/*.routes.ts`，数据形态见 `shared/src/types/`。复杂返回体在文末「类型附录」统一定义，端点处只写类型名 + 包裹键。新增/改动端点请同步本文件与 OpenAPI 快照。

## 鉴权方案

| 标记 | 含义 | 怎么带 |
|---|---|---|
| **公开** | 无需凭证 | 直接请求 |
| **JWT** | 登录用户（`requireAuth`） | `Authorization: Bearer <jwt>`；JWT 含 `worldId`，切世界后旧 token 全 401 |
| **JWT?** | 可选登录（`optionalAuth`） | 带 JWT 有观察者态（likedByViewer 等），不带也可读 |
| **admin-key** | 管理端（`requireAdmin`） | `Authorization: Bearer <adminKey>`（默认 `dev-admin-key`，env `SOCIALSIM_ADMIN_KEY`） |
| **SSE-token** | EventSource 流 | `?token=<jwt>`（EventSource 带不了 header） |

> ⚠️ **`/api/admin/worlds*` 当前无鉴权**（路由未挂 preHandler）。习惯上仍带 admin-key，但服务端未强制。

## 通用约定

- **游标分页** `Page<T> = { items: T[]; nextCursor: string | null }`；`nextCursor` 为 base64url(JSON 数组)，不透明；`limit` 多数上限 50；下一页带 `?cursor=<nextCursor>`。
- **虚拟时间**：所有时间字段为世界模拟时间（unix 毫秒），非系统时间。
- **多世界**：任一时刻一个活动世界；读写默认作用于活动世界。
- **错误**：`{ statusCode, error, message }`（如 400 校验失败 / 401 未登录 / 403 越权 / 404 不存在 / 409 冲突）。
- **路径参数**：`:handle` = 账号 handle（不含 @）；`:id` = 数字 id。

---

## 认证 `auth`

- **POST** `/api/auth/register` · 公开 — 注册真人账号
  - body `RegisterRequest`：`{ handle, displayName, password }`
  - `201` `{ token: string, user: UserProfile }`
- **POST** `/api/auth/login` · 公开 — 登录
  - body `LoginRequest`：`{ handle, password }`
  - `200` `{ token: string, user: UserProfile }`
- **GET** `/api/auth/me` · JWT — 当前登录用户
  - `200` `{ user: UserProfile }`

## 账号 `users`

- **GET** `/api/users/:handle` · JWT? — 账号资料
  - `200` `{ user: UserProfile }`
- **GET** `/api/users/suggested` · JWT? — 推荐关注
  - `200` `{ users: (UserSummary & { followerCount })[] }`
- **PATCH** `/api/users/me` · JWT — 改本人资料
  - body `UpdateProfileRequest`：`{ displayName?, bio?, avatarMediaId?, bannerMediaId?, verified?, website?, location?, birthDate?, profession? }`
  - `200` `{ user: UserProfile }`

## 帖子 `posts`

- **POST** `/api/posts` · JWT — 发帖
  - body `CreatePostRequest`：`{ content, replyToId?, quoteOfId?, mediaIds?(≤? 见 schema) }`（有媒体时 content 可空）
  - `201` `{ post: PostView }`
- **GET** `/api/posts/:id` · JWT? — 单帖详情（删除返墓碑）
  - `200` `{ post: PostView }`
- **GET** `/api/posts/:id/replies` · JWT? — 某帖的回复
  - query `{ cursor?, limit? }` → `200` `Page<PostView>`
- **GET** `/api/users/:handle/posts` · JWT? — 某账号的帖
  - query `{ type?: 'posts'|'replies'(默认 posts), cursor?, limit? }` → `200` `Page<PostView>`（posts 含引用、不含回复）
- **GET** `/api/users/:handle/likes` · JWT? — 某账号点赞过的帖
  - query `{ cursor?, limit? }` → `200` `Page<PostView>`（⚠️ 返回帖本身，**不含点赞时间**；点赞时间见互动事件流）
- **GET** `/api/users/:handle/media` · JWT? — 某账号的含媒体帖
  - query `{ cursor?, limit? }` → `200` `Page<PostView>`
- **DELETE** `/api/posts/:id` · JWT — 删帖（仅本人）→ `204`
- **POST** `/api/posts/:id/pin` · JWT — 置顶 → `200` `{ pinnedPostId: number | null }`
- **DELETE** `/api/posts/:id/pin` · JWT — 取消置顶 → `200` `{ pinnedPostId: number | null }`
- **POST** `/api/posts/views` · JWT? — 曝光计数上报
  - body `{ ids: number[] }` → `204`

## 时间线 `timeline`

- **GET** `/api/timeline/home` · JWT — 关注流
  - query `{ sort?: 'latest'|'hot', cursor?, limit? }` → `200` `Page<TimelineItem>`
- **GET** `/api/timeline/foryou` · JWT? — 推荐流 → `200` `Page<TimelineItem>`
- **GET** `/api/timeline/global` · JWT? — **全站流（firehose）**：所有账号顶层帖按时间
  - query `{ cursor?, limit? }` → `200` `Page<TimelineItem>`（⚠️ **仅顶层帖**，不含回复；转发为 `type:'repost'`）
- **GET** `/api/users/:handle/timeline` · JWT? — 某账号主页流（其帖 + 转发）
  - query `{ cursor?, limit? }` → `200` `Page<TimelineItem>`

## 互动 `interactions`

- **POST/DELETE** `/api/posts/:id/like` · JWT — 赞/取消 → `200` `InteractionResult { active, count }`
- **POST/DELETE** `/api/posts/:id/repost` · JWT — 转/取消 → `200` `InteractionResult`
- **POST/DELETE** `/api/posts/:id/bookmark` · JWT — 收藏/取消（私密）→ `200` `{ active: boolean }`
- **POST/DELETE** `/api/posts/:id/hide` · JWT — 隐藏/取消（"不感兴趣"）→ `200` `{ active: boolean }`
- **GET** `/api/bookmarks` · JWT — 本人收藏
  - query `{ cursor?, limit? }` → `200` `Page<PostView>`
- **GET** `/api/users/:handle/interactions` · JWT? — **某账号互动事件流**（赞/转/关注，带发生时间）
  - query `{ cursor?, limit? }` → `200` `Page<InteractionEvent>`

## 关注 / 屏蔽 `follows` / `blocks`

- **POST/DELETE** `/api/users/:handle/follow` · JWT — 关注/取关 → `200`（关注态结果）
- **GET** `/api/users/:handle/followers` · 公开 — 粉丝
  - query `{ cursor?, limit? }` → `200` `Page<UserSummary>`
- **GET** `/api/users/:handle/following` · 公开 — 关注列表
  - query `{ cursor?, limit? }` → `200` `Page<UserSummary>`
- **POST/DELETE** `/api/users/:handle/block` · JWT — 屏蔽/取消 → `200`（屏蔽态结果）

## 通知 `notifications`

- **GET** `/api/notifications` · JWT — 列表
  - query `{ filter?: 'all'|'mentions', cursor?, limit? }` → `200` `Page<NotificationView>`
- **GET** `/api/notifications/unread-count` · JWT — 未读数 → `200` `{ count: number }`
- **POST** `/api/notifications/read-all` · JWT — 全部已读 → `200`
- **POST** `/api/notifications/read` · JWT — 标部分已读
  - body `{ ids: number[] }` → `200`

## 私信 `messages`（视图类型见 `shared/src/types/dm.ts`）

- **POST** `/api/messages/conversations` · JWT — 发起会话 · body `{ userId }` → 会话视图
- **GET** `/api/messages/conversations` · JWT — 会话列表 · query `{ filter?: 'inbox'|'unread'|'requests'|'hidden', cursor?, limit? }` → `Page<会话视图>`
- **GET** `/api/messages/conversations/:id` · JWT — 单会话
- **DELETE** `/api/messages/conversations/:id` · JWT — 隐藏会话
- **GET** `/api/messages/conversations/:id/messages` · JWT — 消息 · query `{ cursor?, limit? }` → `Page<消息视图>`
- **POST** `/api/messages/conversations/:id/messages` · JWT — 发消息 · body `{ content, mediaIds?(≤4) }`
- **POST** `/api/messages/conversations/:id/read` · JWT — 标已读 · body `{ messageId? }`
- **POST** `/api/messages/conversations/:id/unread` · JWT — 标未读
- **POST** `/api/messages/conversations/:id/accept` · JWT — 接受消息请求
- **POST/DELETE** `/api/messages/conversations/:id/mute` · JWT — 免打扰 开/关
- **POST/DELETE** `/api/messages/conversations/:id/pin` · JWT — 置顶 开/关
- **GET** `/api/messages/unread-count` · JWT — 私信总未读 → `{ count }`
- **POST** `/api/messages/read-all` · JWT — 全部已读
- **GET** `/api/messages/search` · JWT — 搜会话/消息 · query `{ q }`
- **DELETE** `/api/messages/:messageId` · JWT — 删消息
- **PUT/DELETE** `/api/messages/:messageId/reaction` · JWT — 表情回应 设/删 · PUT body `{ emoji }`（枚举见 `MESSAGE_REACTION_EMOJIS`）
- **GET** `/api/messages/stream` · SSE-token — 私信实时流（SSE，`?token=<jwt>`）

## 搜索 `search`

- **GET** `/api/search/posts` · JWT? · query `{ q, cursor?, limit? }` → `Page<PostView>`
- **GET** `/api/search/users` · JWT? · query `{ q, cursor?, limit? }` → `Page<UserSummary 类>`
- **GET** `/api/search/trends` · 公开 · query `{ limit?(≤20) }` → 趋势项数组

## 媒体 `media`

- **POST** `/api/media/upload` · JWT — 上传文件（multipart）→ `MediaView`
- **POST** `/api/media/from-url` · JWT — 外链下载入库
  - body `{ url, source? }` → `MediaView`（虚拟用户配图链路：搜图 → 此入库 → 带 mediaIds 发帖）
- **GET** `/api/media/:id/file` · 公开 — 媒体文件流 · query `{ w: worldId }`（`<img>/<video>` 用；`?w=` 防跨世界缓存撞号）
- **GET** `/api/media/:id/stream` · 公开 — 流式视频代理 · query `{ w }`（由 video-search 模块注册）

## 搜图 `media-search`（实例级配置在 `data/media-search.json`）

- **GET** `/api/media-search` · JWT — 关键字搜图 · query `{ q, source?, rating?: 'safe'|'all'|'r18' }` → 候选图数组（配图链路第一环）
- **GET** `/api/media-search/sources` · JWT — 可用图源
- **GET** `/api/media-search/preview` · 公开 — 外链预览代理 · query `{ url }`（白名单在 service）
- **GET** `/api/media-search/config` · JWT — 读搜图配置
- **PATCH** `/api/media-search/config` · JWT — 改配置 · body `Partial<MediaSearchConfig>`（proxy / pixiv / pexels / danbooru / gelbooru / bilibili / video 策略等）
- **POST** `/api/media-search/pixiv/login` · JWT — Pixiv CDP 引导登录
- **POST** `/api/media-search/pixiv/code` · JWT — 提交 Pixiv code · body `{ code }`
- **GET** `/api/media-search/pixiv/login/status` · JWT — Pixiv 登录态
- **POST** `/api/media-search/bilibili/login` · JWT — B 站引导登录
- **GET** `/api/media-search/bilibili/login/status` · JWT — B 站登录态

## 视频引入 `video-search`

- **POST** `/api/video/ingest` · JWT — 引入视频 · body `{ url, mode?: 'auto'|'download'|'stream' }`（异步，返回任务）
- **GET** `/api/video/sources` · JWT — 视频源
- **GET** `/api/video/search` · JWT — 搜视频 · query `{ q, source? }`
- **GET** `/api/video/tasks` · JWT — 异步任务列表
- **GET** `/api/video/tasks/:id` · JWT — 单任务查询
- **DELETE** `/api/video/tasks/:id` · JWT — 取消任务

## 工具 `tools`（yt-dlp / ffmpeg 二进制管理）

- **GET** `/api/tools/status` · JWT — 安装状态
- **GET** `/api/tools/latest` · JWT — 最新版本
- **POST** `/api/tools/:id/install` · JWT — 安装（`:id` = `yt-dlp`|`ffmpeg`）
- **GET** `/api/tools/:id/install/status` · JWT — 安装进度

## 世界管理 `worlds`（`/api/admin/worlds*`，当前无鉴权——见上注）

- **GET** `/api/admin/worlds` — 列世界 → `WorldSummary[]`
- **POST** `/api/admin/worlds` — 创建
  - body `{ id, name, description?, locale?: 'zh-CN'|'en', contentRating?: 'safe'|'all', clock?: { simTimeMs?, scale?, paused? }, calendar?: { label } }`
- **GET** `/api/admin/worlds/active` — 活动世界 + 当前模拟时间 → `ActiveWorldInfo { meta: WorldMeta, simTimeMs }`
- **POST** `/api/admin/worlds/:id/activate` — 激活（切换）世界
- **PATCH** `/api/admin/worlds/:id` — 改元数据
- **POST** `/api/admin/worlds/clock` — 时钟控制 · body `{ type: 'pause'|'resume'|'setScale'|'setTime', scale?, simTimeMs? }` → `{ clock: ClockState }`
- **POST** `/api/admin/worlds/:id/copy` — 复制 · body `{ newId }`
- **DELETE** `/api/admin/worlds/:id` — 删除
- **POST** `/api/admin/worlds/snapshots` — 对活动世界建快照 · body `{ name, description? }`
- **GET** `/api/admin/worlds/:id/snapshots` — 列快照
- **POST** `/api/admin/worlds/:id/snapshots/:name/restore` — 恢复快照
- **DELETE** `/api/admin/worlds/:id/snapshots/:name` — 删快照

## 管理端 `admin`（全部 admin-key，除模拟器状态）

- **POST** `/api/admin/users` — **代理建号**（设 is_bot=1）
  - body `{ handle, displayName, password? }`（未给 password 则随机生成并返回）
  - `200` `{ id, handle, displayName, password }`；命名违规（`sim_`/`bot`/`npc`/`xxx_amb`/`user\d+` 等）`400`，handle 重复 `409`
- **GET** `/api/admin/users` — 列账号 → `{ users: { id, handle, displayName, isBot }[] }`
- **POST** `/api/admin/login-as` — 代登录票据（不需密码，供模拟器驱动）· body `{ userId }` → `{ token }`
- **POST** `/api/admin/posts` — 代理发帖（可建历史/回复/引用）· body `{ authorId, content, createdAt?, replyToId?, quoteOfId? }`
- **POST** `/api/admin/posts/:id/counts` — 计数注水 · body `{ likeCount?, repostCount?, replyCount?, viewCount? }`
- **POST** `/api/admin/follows` — 批量关注 · body `{ pairs: { followerId, followeeId }[] }`
- **POST** `/api/admin/import` — 批量导入 · body `{ posts?, follows?, counts? }`
- **GET** `/api/admin/content-pools` — 读内容池（扁平 `string[]`，Phase 1 将被三层 ECS 取代）
- **POST** `/api/admin/content-pools` — 增条目 · body `{ poolType, key, items: string[] }`
- **DELETE** `/api/admin/content-pools/:poolType/:key` — 清某池
- **GET** `/api/admin/npc-profiles` — 列 NPC 档案
- **GET/PUT/DELETE** `/api/admin/npc-profiles/:userId` — 读/写/删某账号 NPC 档案（被驱动账号 = 有档案者）；PUT body 为档案对象（tier/interests/activeHours/各概率/actionIntervalMinutes…）
- **GET/POST** `/api/admin/topics` — 列/建话题（POST body `{ title, description?, heat?, tags? }`）
- **PATCH/DELETE** `/api/admin/topics/:id` — 改/删话题
- **GET** `/api/admin/lore` — 列设定文档
- **GET/PUT/DELETE** `/api/admin/lore/:filename` — 读/写/删设定文档（PUT body `{ content }`）
- **GET** `/api/admin/llm-config` — 读 LLM 配置
- **PUT** `/api/admin/llm-config` — 存 LLM 配置
- **POST** `/api/admin/llm-config/fetch-models` — 拉模型列表 · body `{ source, apiKey, baseUrl? }`
- **POST** `/api/admin/run-agent` — 拉起 Agent 执行 · body `{ prompt }`

## 模拟器状态（公开）

- **GET** `/api/simulator/status` · 公开 — 模拟器状态（编辑器轮询）→ `SimulatorStatus`
- **POST** `/api/simulator/heartbeat` · 公开 — 模拟器上报心跳（每 loop）· body `SimulatorHeartbeat`

---

## 编辑器后端代理（`editor/src/server`，:5176，非社交站；renderer 唯一数据源）

转发社交站 + 读模拟器观测库。详见 `editor/src/server/index.ts`。

- **GET** `/health` → `{ ok: true }`
- **GET** `/api/worlds/active` — 转发活动世界
- **GET** `/api/simulator/status` — 转发模拟器状态
- **POST** `/api/worlds/clock` — 转发时钟控制
- **GET/PUT** `/api/layouts` — 读/写该世界编辑器布局（`data/worlds/<id>/editor-layouts.json`）
- **GET** `/api/users/:handle` · `/posts` · `/timeline` · `/interactions` — 转发社交站对应端点（时间轴取数）
- **GET** `/api/timeline/global` — 转发全站流（时间轴主轴）
- **GET** `/api/trace?from&to&entity&limit` — 只读活动世界 `sim-trace.db` 决策轨迹 → `{ events: StoredSimTraceEvent[] }`
- **GET** `/api/trace/stream` — 决策轨迹 SSE
- **POST** `/api/trace/ingest` — 模拟器推轨迹入口 → 转发 SSE

---

## 类型附录

字段以 `shared/src/types/` 为准，此处列关键项便于查阅。

**`Page<T>`** = `{ items: T[]; nextCursor: string | null }`

**`UserSummary`**（嵌入用）= `{ id, handle, displayName, avatarUrl: string|null, verified: 'none'|'personal'|'org' }`

**`UserProfile`** extends `User{ id, handle, displayName, bio, createdAt }` += `{ followerCount, followingCount, postCount, followedByViewer, blockedByViewer, pinnedPostId: number|null, avatarUrl, bannerUrl, avatarMediaId, bannerMediaId, verified, verifiedAt, website, location, birthDate, profession, knownFollowers: UserSummary[], knownFollowerCount }`

**`Post`**（实体）= `{ id, authorId, content, replyToId: number|null, quoteOfId: number|null, createdAt, likeCount, repostCount, quoteCount, replyCount, viewCount, deleted }`

**`PostView`** extends `Post` += `{ author: UserSummary, likedByViewer, repostedByViewer, bookmarkedByViewer, quoted: PostView|null, authorFollowedByViewer, media: MediaView[], linkCard: LinkCardView|null, inReplyTo?: PostView|null, replyToHandle?: string|null }`

**`MediaView`** = `{ id, type: 'image'|'video', url, width, height, durationMs?, posterUrl?, storage?: 'library'|'stream' }`（`url` 形如 `/api/media/<id>/file?w=<worldId>`）

**`TimelineItem`** = `{ type: 'post'|'repost', post: PostView, repostedBy: UserSummary|null, activityAt: number }`（`activityAt`：原帖为发布时间、转发为转发时间）

**`InteractionEvent`** = 三选一：
- `{ type: 'like',   at: number, post: PostView }`
- `{ type: 'repost', at: number, post: PostView }`
- `{ type: 'follow', at: number, target: UserSummary }`

**`NotificationView`** = `{ id, type: NotificationType, actor: UserSummary, actorFollowerCount, actorFollowedByViewer, postId: number|null, postExcerpt: string|null, postMedia: {type,url}|null, read }`

**`InteractionResult`** = `{ active: boolean, count: number }`

**`WorldMeta`** = `{ id, name, description, locale: 'zh-CN'|'en', clock: ClockState, calendar: { label }, contentRating: 'safe'|'all', createdAtRealMs }`；**`ClockState`** = `{ simTimeMs, scale, paused }`

**`ActiveWorldInfo`** = `{ meta: WorldMeta, simTimeMs }`；**`WorldSummary`** = `{ id, name, description, locale, active }`

**`SimulatorStatus`** = `SimulatorHeartbeat{ boundWorldId: string|null, accountCount, tickNumber, lastFlushedWorldId: string|null, lastFlushAt: number|null }` += `{ running: boolean, reportedAt: number|null }`

**`StoredSimTraceEvent`**（决策轨迹，编辑器后端 `/api/trace` 返回）= `{ id, at, simTime, entity, action: 'post'|'reply'|'quote'|'like'|'repost'|'follow', activityState?, intent?, shape?: 'standalone'|'reply'|'quote'|null, poolId?, entryId?, mediaAttached?, mediaReason?, targetPostId? }`

> 私信视图（会话 / 消息）见 `shared/src/types/dm.ts`；`LinkCardView`、`NotificationType`、`MediaSearchConfig` 等见对应 `shared` / 模块文件。
