# NewSocialSim 设计与路线图

## 项目定位

NewSocialSim 是一个本地运行的社交媒体模拟器（仿 X/Twitter），开发分两个阶段：

1. **第一阶段**（已完成）：一个真实、完整、可正常注册发帖的社交媒体网站（前端 + 后端）。
2. **第二阶段**（未开始）：以该网站的 HTTP API 为唯一接口构建模拟器。虚拟用户与真人走完全相同的注册 / 发帖 / 点赞 / 关注 API，模拟器层不侵入网站代码。

项目用途有三，功能取舍时三者都要照顾：

1. **观察娱乐**：看虚拟社会自行运转，用户本人也可注册账号下场参与。
2. **小说创作辅助**：为不同小说世界观生成"活的"社交媒体，给角色一个发声平台。
3. **研究实验**：观察信息传播、舆论形成等，需要数据导出与统计能力。

## 已确认的设计决策

| 决策点 | 结论 |
|---|---|
| 技术栈 | 全 TypeScript；后端 Fastify + better-sqlite3；前端 React + Vite + Tailwind CSS；npm workspaces monorepo |
| 架构风格 | 贫血模型（实体为纯数据接口，逻辑在 service 层）；后端按功能域分层 MVC；第二阶段模拟器采用 ECS |
| 多世界观 | 一个世界 = 一个文件夹（world.db + world.json），完全隔离；备份 / 平行宇宙 = 复制文件夹 |
| 世界切换 | 运行中热切换；JWT 内含 worldId，切换后旧 token 自动失效（401 → 前端登出） |
| 虚拟时间 | 每个世界有独立时钟（当前模拟时间、流速、暂停态），持久化在 world.json；被切换出去的世界时钟冻结，切回后从挂起点继续 |
| 帖子删除 | 软删除：内容清空、标记 deleted，保留墓碑维持对话串完整 |
| 密码哈希 | Node 内置 crypto.scrypt，不引入原生依赖 |
| 内容生成 | 分档混合：氛围内容由规则 / 模板引擎与批量池化承担，核心账号与 GM 由 LLM 生成；LLM 经 ContentGenerator → LLMProvider 抽象接入，优先适配 Claude / DeepSeek / Gemini，每厂高能力与低成本双档按任务路由 |
| 界面语言 | i18n 可切换（zh-CN / en），世界可配置默认语言 |
| 分页 | 所有列表接口用游标分页：游标为 base64url 编码的排序键数组，响应统一为 `{ items, nextCursor }` |

## 架构约束

以下规则适用于全部后续开发：

- 依赖方向必须严格单向：routes → controller → service → repo。routes 和 controller 保持薄，业务逻辑全部放在 service。
- 跨模块只允许 service 调用 service。repo 不得调用其他模块的 repo。
- 业务代码不得直接调用 `Date.now()`，时间一律来自当前世界上下文中的 IClock。允许的例外：SimClock 自身的内部换算、WorldManager 的管理类元数据（如 createdAtRealMs）、与世界无关的基础设施。
  - 违例示例：`posts.service` 里写 `createdAt: Date.now()`。正确写法：`const { clock } = this.worldManager.current(); createdAt: clock.now()`。
- 任何模块不得长期持有数据库连接，必须在每次请求时通过 `WorldManager.current()` 获取上下文，否则热切换后会写入已关闭的旧世界连接。
- 所有功能必须先有 API 再有界面。不允许存在"只有前端能完成的操作"——第二阶段的虚拟用户只能走 API。
- migration 只增不改：已提交的 migration 条目不得再编辑，schema 变更一律追加新版本。
- 服务端读取 world.json / state.json 等 JSON 文件时必须容忍 UTF-8 BOM（Windows 编辑器常默认写入 BOM）。
- 新增需要登录的路由使用 requireAuth；需要"观察者状态"（如是否已赞、是否已关注）但允许匿名的路由使用 optionalAuth。

## 系统结构

```
NewSocialSim/
├── shared/                 # 前后端/模拟器共用的纯类型定义
├── server/                 # Fastify 后端（端口 3000）
│   └── src/
│       ├── core/           # 业务无关基础设施
│       │   ├── clock/      # IClock 接口 + SimClock
│       │   ├── db/         # SQLite 连接 + 版本化 migration
│       │   ├── world/      # WorldManager（热切换核心）
│       │   ├── auth/       # JWT 密钥、requireAuth / optionalAuth 守卫
│       │   ├── events/     # SseHub（SSE 连接中枢：心跳/按用户推送/热切换清场）
│       │   ├── errors/     # AppError 体系
│       │   └── pagination.ts
│       └── modules/        # 每模块四件套 routes/controller/service/repo
│           ├── worlds / auth / users / posts / interactions
│           ├── follows / timeline / notifications / search
│           ├── blocks / media / media-search / link-cards / messages
├── client/                 # React 前端（Vite 端口 5173，/api 代理到 3000）
│   └── src/
│       ├── api/            # fetch 封装与全部接口定义
│       ├── auth/ world/ i18n/   # 三个全局 Context
│       ├── components/     # Layout、PostCard、Composer 等通用组件
│       └── features/       # 按页面功能组织：timeline/post/profile/...
├── simulator/              # 模拟引擎（第二阶段，当前为空）
├── scripts/                # 验收脚本（verify-m3.ps1 为后端 API 回归）
└── data/worlds/<id>/       # 运行时数据（不入 git）：world.db + world.json
```

### 数据库 schema（当前 version 13）

- `users(id, handle UNIQUE NOCASE, display_name, bio, password_hash, is_bot, created_at, pinned_post_id, avatar_media_id, banner_media_id, verified, website, location, birth_date, profession, verified_at)` —— `verified` 为 'none'/'personal'/'org'（蓝标/金标，PATCH /api/users/me 自助设定，变更时以模拟时间打点 `verified_at`），`website` 为个人链接（存储时无协议自动补 https://），`location` 为自由文本地名（可虚构），`birth_date` 为 YYYY-MM-DD，`profession` 为专业类别 key（前端 i18n 映射展示）
- `posts(id, author_id, content, reply_to_id, quote_of_id, created_at, like_count, repost_count, quote_count, reply_count, view_count, deleted)`
- `likes(user_id, post_id, created_at)`、`reposts(...)`、`bookmarks(...)`、`hidden_posts(...)` —— 主键 (user_id, post_id)
- `follows(follower_id, followee_id, created_at)`
- `blocks(blocker_id, blocked_id, created_at)` —— 主键 (blocker_id, blocked_id)
- `notifications(id, user_id, type, actor_id, post_id, read, created_at)`
- `media(id, owner_id, type, file_name, mime, width, height, size_bytes, source, origin_url, created_at, storage, duration_ms, poster_media_id)`、`post_media(post_id, media_id, position)` —— 主键 (post_id, position)。`storage` 为 'library'（文件入库）/'stream'（流式引用：file_name 空、只存 origin_url 与元数据）；`duration_ms` 视频时长；`poster_media_id` 指向视频海报图（独立 image media 行，不挂帖）；origin_url 有索引供同源去重
- `link_cards(url PRIMARY KEY, title, description, image_media_id, site_name, status, fetched_at)` —— OG 元数据按 URL 缓存（失败也缓存）；`embedUrl` 不落库，由 url 现算（YouTube/B 站可嵌入站点）
- `conversations(id, type, dm_key UNIQUE, created_by, created_at, last_message_id, last_message_at)` —— 私信会话；`type` 为 'dm'/'group'（群聊预留，当前 API 只产出 dm）；`dm_key` 为 `'<小用户id>:<大用户id>'`，保证同一对用户唯一会话且天然防并发双建；`last_message_*` 为反规范化的列表预览与排序字段
- `conversation_participants(conversation_id, user_id, state, last_read_message_id, hidden_at, joined_at, marked_unread, muted, pinned_at)` —— 主键 (conversation_id, user_id)；`state` 为 'inbox'/'request'（消息请求放参与者维度：发起方永远 inbox，接收方视角才可能是 request）；`hidden_at` 实现"删除会话/拒绝请求 = 只对自己隐藏"；`marked_unread` 为手动未读标记（任何已读动作清除）、`muted` 静音（不计导航角标）、`pinned_at` 置顶（收件箱浮顶，列表用 [置顶位,时间,id] 三段游标）
- `messages(id, conversation_id, sender_id, content, created_at, deleted)` —— 软删除墓碑同 posts；`message_media(message_id, media_id, position)` 同 post_media 形态；`message_reactions(message_id, user_id, emoji, created_at)` 主键 (message_id, user_id)——每人每消息一个回应，换 emoji 为 UPSERT 覆盖

所有 `created_at` 存储的是世界模拟时间（unix 毫秒形式）。`users.is_bot` 为第二阶段虚拟用户预留。计数字段（like_count 等）为反规范化，由 service 在事务内随互动维护；`view_count` 为曝光计数，由客户端经 `POST /api/posts/views` 批量上报（会话内去重），service 另留 `addViews(postId, delta)` 任意增量方法供未来管理端注入模拟浏览量。

屏蔽为单向隐藏：被屏蔽者的帖子/转发从屏蔽者的关注流、为你推荐、全站流、搜索、回复区消失，其互动产生的通知（含未读数）被过滤，推荐关注排除；个人主页时间线、书签与喜欢列表、帖子详情主体不过滤（主动访问场景）。`hidden_posts`（隐藏单帖）在相同范围生效。置顶为每用户一条（`users.pinned_post_id`），个人主页时间线排除置顶帖、由前端单独渲染在顶部。

媒体系统：文件存 `data/worlds/<id>/media/<mediaId>.<ext>`（世界自包含，复制文件夹即含全部媒体），路径每次经活动世界现算保证热切换安全。文件端点 `GET /api/media/:id/file?w=<worldId>` 公开（img 标签带不了 JWT）、支持 Range/206（视频拖进度条）并返回 immutable 缓存头，`?w=` 防止切世界后媒体 id 撞号造成浏览器缓存污染。一条媒体只能挂一处——帖子或私信消息（一帖最多 20 个、一条消息最多 4 个，图/视频可混排；帖子卡宫格只显示前 4 个、超出在第 4 格叠 "+N" 角标，全部媒体在大图查看器里滑动），头像/Banner 不占名额；纯媒体帖允许空文案；软删帖保留媒体文件与关联。大图查看器经帖子打开时对照 X：右侧可收起的帖子详情面板（作者/正文/互动栏/回复框/回复列表，与详情页共享 `['post', id]`/`['replies', id]` 缓存）+ 媒体下方完整互动栏（共享 PostActions 组件，写穿全站缓存）；私信媒体与头像/横幅大图不带面板。外部图片（URL 引入/搜图）一律经 `POST /api/media/from-url` 下载入库不热链（safe-fetch 做 SSRF 防护与限量下载；i.pximg.net 等防盗链站点自动带 Referer）。正文首个 URL 在发帖时抓取 OG 元数据生成链接卡片（link_cards 表按 URL 缓存：成功条目永久缓存，失败条目在下次有帖引用同 URL 时重试；抓取带 Chrome UA、10s/2MB——YouTube 等重型页 og 标签在 ~650KB 处；B 站 og:image 自动剥 @WxH 低清后缀取原图；缩略图入库；有媒体的帖不显示卡片；抓取失败不阻断发帖）。媒体系统 A 图片地基 / B 视频 / C URL 引入+OG 链接卡片 / D 关键字搜图四期已全部完成。

视频引入系统（tools + video-search 模块）：从外站搜索与引用视频，三种形态并存、用户自选——嵌入式链接卡（YouTube/B 站正文链接渲染官方 iframe 播放器，零存储，默认形态）/ 下载入库（yt-dlp 完整下载进世界 media 目录，永久）/ 流式引用（只存 origin_url+元数据+海报，播放时服务端现解直链做 Range 透传代理，源失效即不可播）。`POST /api/video/ingest { url, mode:'auto'|'download'|'stream' }`：auto 服务端形态路由——可嵌入站点默认回 embed 不建任务（URL 留正文走链接卡），siteModes 可逐站覆盖；非可嵌入站点按全局 defaultMode；显式 mode 无条件执行。引入为异步任务（进程内任务表，每用户并发 2，重启丢任务），轮询 `GET /api/video/tasks`。同源去重：同 origin_url 已入库视频复用（硬链接零拷贝）。依赖 yt-dlp/ffmpeg 二进制（tools 模块管理，设置页一键安装到 data/bin/，下载源可换镜像）。限额仅约束下载模式（默认 720p/150MB，media-search.json 的 video 段可调）。关键字搜索三源（youtube/pornhub/rule34video，`GET /api/video/search`）：**视频源不设内容分级**（平台性质自决可见内容，不受世界 contentRating 约束），唯一可用性条件是 yt-dlp 是否安装。流式播放代理 `GET /api/media/:id/stream?w=`（公开，video 标签带不了 JWT）：直链缓存（有 expire 参数按其计，无则 20 秒短 TTL 强制频繁重解析换新鲜直链）+ Range 透传（逐跳 SSRF 校验）+ per-mediaId 串行锁（rule34video/pornhub 签名直链不支持同签名并发，浏览器播放却多连接并发）。B 站需登录态（412 风控），凭证经 CDP 引导登录捕获（同 Pixiv 范式），Cookie 走 --cookies（Netscape jar，跨子域生效）。防盗链缩略图（pixiv/phncdn）经 refererForHost 带 Referer。**已知限制**：Pornhub 流式播放与部分缩略图因 CDN 风控+短时效仍不稳定（R18 用 Rule34Video 已够，PH 默认走下载模式）；YouTube 流式多为 360p（高清需下载）。详见 docs/devlog/2026-06-13-视频引入系统.md。

私信系统（messages 模块）：1v1 会话经 `POST /api/messages/conversations` find-or-create（屏蔽双向任一即 403；自己 400；目标不存在 404），消息请求在**首条消息发送时**判定——接收方未关注发送方则其参与行置 'request'，接受（`POST .../accept`）或回复（隐式接受）后转 'inbox'；接受前会话页不上报已读，对方看不到已读回执。非参与者访问一律 404（不泄露会话存在性）。消息列表是全站唯一"倒序查、升序展示"的列表（`id DESC` + beforeId 游标，前端 reverse 渲染、向上滚动加载更早页）。已读/未读/Seen/游标全部基于消息 id 而非时间戳（模拟时钟可被设回过去）；`markRead` 只增不减。消息软删除为墓碑（同 posts），墓碑禁止回应且仍占用媒体；消息媒体上限 4，媒体占用与帖子互斥（`mediaRepo.attachedSet` 为 post_media UNION message_media）。未读角标 `GET /api/messages/unread-count` 返回 `{ count: 收件箱含未读的会话数, requestCount: 待处理请求数 }`，DM 不写 notifications 表（独立未读体系，同 X）。删除会话/拒绝请求只置自己的 `hidden_at`，对方再发消息（`last_message_at > hidden_at`）后会话重现且显示全部历史（不做 X 的"清除到某点"截断，已知简化）；被拒绝的请求可在"隐藏"过滤器（filter=hidden）里找回，接受（显式或回复隐式）会同时清除 hidden_at。会话列表过滤器为 inbox/unread/requests/hidden 四种，inbox 置顶浮顶（[置顶位,时间,id] 三段游标）；`POST /api/messages/read-all` 全部标已读（只动收件箱）；`GET /api/messages/search?q=` 按对方用户名/昵称命中会话 + 按内容命中消息（各取前若干，不分页，排除墓碑与隐藏会话）。参与者级三标记：手动未读（任何已读动作清除）、静音（不计导航角标，列表仍显示未读）、置顶。消息正文与发帖共享解析（蓝链/#/@、@ 候选、OG 链接卡片同一链路，`sendMessage` 为 async）。

私信实时推送（core/events/sse-hub.ts）：`GET /api/messages/stream?token=<jwt>` 为 SSE 长连接——EventSource 带不了 Authorization 头，token 走 query 在路由内手动验签并核对 worldId；handler 用 `reply.hijack()` 自管原始连接，注销挂 `req.raw.on('close')`。SseHub 维护进程内连接表（25 秒注释行心跳、按用户推送、多标签页全收），事件四类 message:new / message:read / message:reaction / message:deleted；发送者本人不回推（前端 mutation 已写穿缓存）。WorldManager 提供 `onActivated(cb)` 钩子（新上下文就绪后触发），热切换与进程退出时 `closeAll()` 清场，旧世界 token 重连即 401。前端 DmStreamProvider 以 user.id 为依赖挂 EventSource（切账号/登出重建），断线回退 10 秒轮询，角标与会话列表保持 30 秒轮询兜底；虚拟用户（第二阶段）不依赖 SSE，纯轮询可完成全部私信操作。后端回归脚本 `scripts/verify-dm.ps1`（72 项断言）。

关键字搜图（media-search 模块）：`GET /api/media-search?q=&source=` 七源（pinterest 匿名优先、pixiv、danbooru、gelbooru、yandere、pexels、wikimedia）统一候选格式，单源直查或全可用源并行；候选经 from-url 入库挂帖——虚拟用户（第二阶段）走同一组 API 即可"一次检索拿图发帖"。实例级配置在 `data/media-search.json`（读容忍 BOM、写无 BOM）：`proxy` 字段经 undici 全局 ProxyAgent 作用于本进程全部出站 fetch（取消代理需重启服务）；各源凭证按需配置，`GET /api/media-search/sources` 报告可用状态。Pixiv 登录采用 CDP 引导：服务端 spawn 本机 Chrome/Edge（独立调试端口 + 临时 profile）打开 OAuth PKCE 登录页，监听 `pixiv://` 回调自动换 refresh token，手动粘贴 code 兜底；不引入 Playwright、不写注册表。内容分级由世界设定 `WorldMeta.contentRating`（safe/all，旧世界缺省 safe）映射到各源过滤参数，R-18G 另由实例配置 `pixiv.allowR18G` 把门。防盗链站点预览经 `GET /api/media-search/preview?url=`（白名单 host）代理。

### 关键机制

**虚拟时钟**：`模拟时间 = 锚点模拟时间 + (真实流逝) × 流速`。调速 / 暂停前先把"此刻"固化为新锚点，保证时间连续。时钟快照每 30 秒落盘到 world.json，进程异常退出最多丢失该间隔。前端按同一公式本地推算并每 60 秒与服务端校准。

**世界热切换**（WorldManager.activate）：先就绪新世界（读元数据 → 开数据库 → 跑 migration），成功后才保存旧世界时钟、关闭旧连接、原子替换上下文、记录活动世界 id。失败不影响当前世界。

**登录态与世界绑定**：JWT 负载为 `{ sub: 用户id, worldId, handle }`。守卫在验签后核对 worldId 与活动世界，不一致返回 401；前端收到 401 即清除 token 回登录页。

## M5 模拟器设计

### 目标用户与体验

模拟器面向四类人群：小说读者、OC / 世界观创作者、AIRP 玩家、网络模拟爱好者。需求归为两类：

1. **沉浸参与**：注册账号进入一个拟真的社交网络，作为其中一员与角色互动或纯潜水。由网站本身承接——虚拟用户与真人走同一组 API、同一个时间线。
2. **高维观看**：以普通用户或上帝视角观看网络世界自行运转。由上帝控制台（时钟控制、批量造人、事件注入、统计图表）与数据导出（帖子 / 互动 / 传播链导出 JSON / CSV）承接。

MVP 验收标准：注册账号进入世界后，时间线上核心 NPC 与氛围账号在自行发帖互动；@ 一个核心 NPC 后，在模拟语境下合理的延迟内收到符合人设的回复。上帝视角的统计图表与数据导出后置。

### 世界数据模型：三层数据 + 三档账号

一个世界的模拟器侧数据按变化频率分三层：

| 层 | 内容 | 变化频率 |
|---|---|---|
| 静态设定层 | 世界观设定文件库（lore，可达数万字、多文件） | 基本不变 |
| 动态议程层 | 当前活跃话题集及其热度生命周期 | 随模拟运转 |
| 账号体系层 | 重要账号（组织 / 个人 NPC）及人设档案 | 低频 |

**统一账号模型**：网站侧所有账号结构一致，不按"是否虚拟"做身份区分。模拟器需要驱动某个账号时，以该账号的凭证调用 API——与真人登录发帖走完全相同的路径。`is_bot` 仅为运营标记（如前端可选择是否显示 bot 徽章），不影响任何业务逻辑或 API 行为。

账号按模拟器的驱动方式分三档：

| 档位 | 数量 | 驱动 | LLM 成本 |
|---|---|---|---|
| 核心账号（组织账号如媒体号 + 个人 NPC） | 10–20 | LLM Agent 按人设生成 | 高 |
| 氛围账号 | 大量、可一次性 | 规则引擎 + 内容池 | 池化均摊 |
| 普通用户 | 不限 | 真人操作（或临时交由模拟器驱动） | — |

氛围账号的职责是让数字活起来（点赞数 / 转发数 / 回复区人气），内容质量要求低。核心账号的人设档案含性格、立场、文风、兴趣标签、活跃时段、行为概率参数、情绪状态；核心账号中必须设计性地包含杠精、乐子人、立场偏激者——负面角色是内容资产，不是事故。

### 模拟器总体架构：双层驱动 + Agent 工具范式

模拟器为独立进程，通过 HTTP API 操作网站，不侵入网站代码。架构分两层，底层无 LLM 依赖即可运转，上层叠加 LLM 增强：

```
┌──────────────────────────────────┐
│  GM + Agent 层（LLM，可选增强）    │ ← 有则精彩，无则不崩
│  话题注入 / 爆款帖 / 核心 NPC 创作  │
└───────────────┬──────────────────┘
                ▼
┌──────────────────────────────────┐
│  Tick 引擎层（规则驱动，零 LLM）    │ ← 世界活着的基础保障
│  活跃采样 / 赞转关 / 内容池模板帖   │
│  互动级联 / 计数注水               │
└───────────────┬──────────────────┘
                ▼
          HTTP API → 网站
```

**底层：Tick 引擎**——规则驱动，无 LLM 依赖。每个被驱动的账号按活跃时段与行为概率独立 tick：该点赞点赞、该从内容池取模板帖就发、该转发转发。世界靠这一层就能"活着"。ECS 架构：Entity = 被模拟器驱动的账号，Component = 人设档案 / 活跃时段 / 行为概率 / 情绪状态 / 话题兴趣，System = 各驱动源的调度系统。

**上层：GM + Agent**——LLM 驱动，叠加在 tick 引擎之上。LLM 专注于最需要创造性的部分：核心 NPC 的个性化内容（少数重要角色须符合人设的帖子和回复）、特定场景的定制内容（爆点事件下一批立场各异、贴合情境的讨论）。其余量（氛围日常、赞转关、灌水）全走 tick 引擎。LLM 预算耗尽时上层停止、底层继续，世界变平庸但不停转。

**GM 是调度者不是创作者**：GM 的上下文轻量（世界摘要、近期热度指标），不持有细致的 NPC 设定或记忆。GM 的输出是任务指令——"给这三个 NPC 各生成一条帖子"、"为这个爆点事件生成讨论串和配套回复"、"给内容池补 20 条评论"——而非帖子内容本身。GM 是上帝控制台的自动驾驶形态：用户手动操作控制台与 GM 指令走同一组管理 API。

#### GM 生命周期

GM 不常驻，由程序按条件唤醒，完成任务分发后立即结束。每次唤醒创建一个新的 Agent 实例，程序组装当前世界快照 + 近期 GM 决策日志作为 prompt，GM 用工具查看世界状态、下发任务指令、输出本轮决策摘要后终止。决策摘要由程序持久化到 GM 日志，下次唤醒时近期日志塞回 prompt 提供连续性。GM 不等任务执行完——任务交给 tick 引擎和 Agent 执行，GM 下次被唤醒时通过工具看结果。

唤醒条件（由 tick 引擎检测）：

| 触发源 | 条件 | 说明 |
|---|---|---|
| 真人用户 | 真人发帖 / @ NPC / 私信 NPC | 有真人在场，世界需要回应 |
| 预设事件 | 世界事件日程的时间点到达 | 创作者预埋或 GM 先前安排的剧情节拍 |
| 资源维护 | 内容池水位低于阈值 | 补水任务 |
| 兜底 | 距上次唤醒超过配置的最大真实时间间隔 | 避免世界长时间无人导演 |

不以"帖子互动异常"、"话题自然升温"等作为触发条件——tick 引擎的规则驱动与内容池不产生真正的有机爆发，所有"有趣的事"要么来自真人用户、要么来自 GM/LLM 创造、要么来自创作者预埋，本质都是被设计的而非自然涌现。

#### Agent 工具范式（核心设计约束）

Agent 的工作方式对标当前主流编程 Agent（Cursor / Claude Code 等）：**系统提示 + 工具集 + agentic 循环**。Agent 不是拿到一个预塞上下文的大 prompt 一次性输出结果，而是通过工具按需拉取上下文、执行动作：

```
收到 GM 分发的任务
  → 用工具读取 NPC 档案 / 世界设定
  → 用工具浏览时间线 / 查看近期帖子
  → 思考要生成什么内容
  → 用工具搜索配套媒体（图片 / 视频）
  → 用工具发帖 / 回复 / 点赞
  → 观察结果，继续或结束
```

工具是 Agent 操作世界的唯一接口：

| 类别 | 工具示例 |
|---|---|
| 读上下文 | read_npc_profile / read_lore / browse_timeline / get_trending_topics |
| 查询 | search_posts / search_users / get_post_replies |
| 创作 | create_post / reply_to_post / quote_post |
| 互动 | like / repost / follow / bookmark |
| 媒体 | search_media / search_video / attach_media |
| 世界 | get_world_summary / list_topics |

设计约束：

- **上下文按需拉取**：Agent 自己决定需要知道什么，不预塞。系统提示 + 工具定义是稳定前缀，天然友好于提示词缓存。
- **能力由工具集定义**：加一个工具就多一种能力，不改 Agent 代码。
- **GM 和任务 Agent 用同一套工具**，只是系统提示和任务范围不同。
- **Agent 按任务组织，不按 NPC 组织**：一个 Agent 可以同时为多个 NPC 生成帖子，另一个专门造爆款讨论串——按 GM 派发的任务粒度工作。
- **生成与发布解耦**：Agent 产出内容后，由模拟器 tick 引擎按时机或 GM 指令控制实际发布节奏。
- **可观测**：每一步工具调用都可记录 / 回放 / 审计，创作者可以看到"模拟器做了什么、为什么这么做"。

### 设定文件库与 agentic 检索

- lore 文件为 Markdown，存于 `data/worlds/<id>/lore/`（世界文件夹保持自包含），由作者外部编写、经 API 导入，站内可浏览。
- 每世界维护一份**世界索引卡**：世界一句话概括、核心规则速览、文件目录与每文件一行摘要。索引卡始终进入生成上下文。
- 每文件摘要优先取文件 frontmatter 或作者自写描述，缺失时由低成本模型生成兜底。
- 检索采用 agentic 方式：给生成 Agent 提供 `list_lore` / `read_lore(file, range)` 工具，按索引卡的指引按需取材。第一版不引入向量 RAG：省去 embedding 基础设施；检索质量由索引摘要保证、作者直接可控；固定索引卡是稳定前缀，向量检索每次注入不同片段会破坏提示词缓存。

### 内容引擎：四个驱动源

时间线的新内容只来自四条路径：

1. **行为时刻表（tick 调度）**：引擎按各账号活跃时段与行为概率抽样"此刻谁在线、各自做什么"，产生日常底噪。氛围账号从内容池取文，核心账号入队 LLM 任务。
2. **话题议程**：世界维护活跃话题集，各话题有热度生命周期（出现 → 发酵 → 峰值 → 退潮）。账号发帖按"自身兴趣标签 × 话题热度"加权选题，保证全网围绕共同话题而非各说各话。话题来源：GM 注入、用户手动注入、设定文件中的世界事件日程、真人帖被提升为话题。
3. **互动级联**：新帖入库后给可能看到它的账号（粉丝、同话题关注者）安排延迟反应判定，按人设概率赞 / 转 / 回复；回复触发下一轮判定，概率逐层衰减、设最大深度。对话串由级联自然生长，不由 AI 刻意安排。赞 / 转 / 关注零 LLM 成本，承担世界大部分"活着的感觉"。
4. **GM 导演 tick**：低频（每真实 10–30 分钟量级）高档模型调用，见上文 GM 层。

### 生成与成本体系

内容生成按成本分四级，每级能完成的事不得上浮到更高级：

| 级别 | 覆盖 | 成本 |
|---|---|---|
| 互动（赞 / 转 / 关注） | 级联的大部分 | 零 |
| 纯模板 / 语料 | 氛围灌水（"蹲一个后续"） | 零 |
| 批量池化生成 | 氛围账号的成文内容 | 一次调用 ÷ N 条 |
| 单独调用 | 核心 NPC 发帖 / 回复、GM | 全价 |

**双内容池**：通用场景池按场景类型索引（如 coser 图帖彩虹屁 / 美食帖 / 比赛庆祝），跨帖复用、几乎不过期；话题评论池按话题索引，生成时规定立场分布，话题退潮即作废。引擎按帖子场景选池取文，从机制上杜绝答非所问。池水位低于阈值自动入队补水任务（低档模型一次产 30–50 条，提示词要求立场 / 语气 / 长度多样化）。LLM 调用时机与发帖时机完全解耦：发帖零延迟零失败、补水避开速率高峰、同话题补水共享稳定前缀。池化内容不知道入池之后发生的事——对氛围账号可接受（真实路人评论本就高度同质），核心 NPC 一律现场生成。

**热帖打包生成**：GM 注入热帖时，一次高档调用产出完整包——正文 + 一组带立场分布的回复（含少量楼中楼）+ 热度档位。注入帖以当前时刻入场（时间序游标分页下，回填过去时间戳的帖对已翻页用户不可见），其回复可回填近过去的时间戳以表现讨论已持续一段时间。

**计数注水**：LLM 只输出热度档位关键字（大热门 / 小热门 / 普通，可加高收藏 / 高争议等修饰），引擎按档位配置的区间采样具体数字，并套用互动指纹——资源帖收藏偏高、争议帖回复多赞少、美图帖赞偏高，比例规则由引擎持有，LLM 不直接产出数字。落地沿用 `addViews(postId, delta)` 的思路，为各计数列提供管理端增量 API。注水计数与真实互动行并存：计数列含注水基数，真实互动在其上累加；点赞者等列表只反映真实行（已知简化，与真实平台"计数对不上列表"的现状一致）。

**预算与降级**：每世界配置每日 token / 调用预算，分档计量。超限不停摆而是降级：核心账号暂用低档模型，氛围内容退回纯模板，世界继续运转只是变平庸。全部生成任务带软过期：积压过久的日程类任务直接丢弃——社交网络不补发昨天的帖。

**统一调度器**：全部 LLM 出站调用经全局调度器，按厂商配置 RPM / TPM 限流，优先级从高到低：对真人的响应（@ / 私信回复）→ GM 指令 → 核心 NPC 日程发帖 → 内容池补水。除第一类外全部任务耐延迟（X 形态的社交网络不是即时通讯），队列可摊平任何突发。

**流速解耦**：内容密度按模拟时间定义（每模拟日帖量，保证回看时间线密度真实），LLM 预算按真实时间结算。流速调高时引擎自动稀释每模拟日的生成内容（更多使用池子与模板），调快时钟不放大成本——快进的世界本就是略览模式。

### LLM 接入

- LLMProvider 抽象层适配 Claude / DeepSeek / Gemini 三家，提供统一的 chat + tool-use 接口。Agent 经 LLMProvider 发起 agentic 循环（发送消息 → 模型返回工具调用 → 执行工具 → 将结果回传 → 模型继续），循环直到模型输出最终结果或达到步数上限。
- 每厂配置高能力与低成本两档模型，按任务路由：GM 决策与核心 NPC 重要内容走高档，普通回帖与池化补水走低档，氛围日常不进 LLM。档位用途可配置。
- API 密钥放实例级配置（data/ 下新配置文件，同 media-search.json 范式：不入 git、读容忍 BOM）；世界级只配置策略（用哪档模型、预算上限）。
- 提示词缓存纪律（硬约束）：Agent 的系统提示 + 工具定义为稳定前缀（字节级不变），agentic 循环中的工具调用历史为缓变部分，当次任务触发内容为易变部分。索引卡与人设卡必须低频批量更新——改一字即全员缓存失效。三家均有上下文缓存（Claude 显式 cache_control、DeepSeek 自动命中、Gemini 隐式 / 显式），缓存友好是 LLMProvider 接口层的约束，不是各实现自行的优化。

### 拟真性防护

**盲评原则（防"媚 user"）**：提示词层全盲——一切喂给 LLM 的内容（GM 的世界摘要、候选帖列表、NPC 收到的 @ 与回复）以统一格式呈现（账号名 / 粉丝数 / 内容 / 互动速度），剥除 `is_bot` 等一切可区分真人与 NPC 的标记，LLM 无从偏向真人。真人身份只在引擎层使用（响应任务进高优先队列、光环旋钮加权），不进提示词。规则闸门保持轻量（冷却时间、话题容量等数值前置条件），内容裁量交给盲评的 LLM，不写复杂状态机。

**现实冷漠基线**：无粉丝账号发帖的默认待遇是 0–2 个氛围互动，由引擎硬编码，不经 LLM。真人帖提升为话题须先通过机械前置条件（粉丝量、互动增速、距上次用户帖爆发的冷却时间、世界话题容量），GM 提示词明确"提升用户内容是罕见事件，须给出理由"。

**光环旋钮**：用户级设置三档——现实模式（默认）/ 温和关注 / 主角光环，由引擎放大该用户帖子进入候选池的权重与氛围互动配额实现；LLM 始终不知道谁开了光环。

**生态基调（防"太好人"）**：评论区氛围分布是显式的世界级配置，不依赖模型默认人格。三层手段：批量生成提示词中规定立场配额（如好评 35% / 玩梗 25% / 抬杠 15% / 阴阳怪气 10% / 无关灌水 10% / 极端言论 5%，比例随世界生态基调预设变化）；lore 中专设语料风格文件——该世界网友说话的真实样例（梗、缩写、句式），批量生成时作 few-shot 喂入且属于稳定前缀；恶评是否允许指向真人用户做成用户级开关。

### 世界初始化与预填内容

世界创建后、模拟启动前，创作者可以预填内容让世界看起来已经运转过一段时间。预填内容在数据层就是普通数据（帖子、互动、关注关系），不做特殊标记——它们就是世界的"历史"。

预填范围：
- **帖子与对话串**：以指定账号身份、指定回溯时间戳创建帖子（含回复链），建立角色的发言历史与世界氛围。
- **互动数据**：计数注水（赞 / 转发 / 浏览量，复用已有机制）+ 关注关系（构建初始社交图谱）。

两种创作模式：
- **手动精编**：创作者在编辑器中逐条编写帖子、选作者、设时间戳，精确控制每一条。适合关键剧情锚点和核心 NPC 的标志性帖子。
- **LLM 批量生成**：创作者给出大纲（如"alice 在过去一周发了 5 条关于摄影的帖子，bob 回复了其中 2 条"），Agent 按大纲批量生成，创作者在编辑器中审核 / 修改 / 删除后确认写入。适合快速填充氛围内容。

需要的管理端能力：以指定用户身份 + 指定时间戳创建帖子的 API（绕过当前"只能以当前登录用户、当前时钟时间发帖"的限制），以及批量导入接口。

### 世界编辑器

编辑器是创作者的主要工作界面，定位是**世界创作工作室**——不是社交网站的管理后台，而是接近 Premiere Pro / Unity Editor / Obsidian 等专业创作工具的形态。核心面板：

**时间轴面板（Premiere 范式）**：横轴为时间，纵轴每行一个账号。以当前模拟时间为分界——左侧是已发布的内容，右侧是待发布的内容。每条帖子 / 互动是时间轴上的一个块。创作者可以选中一组 NPC 只看他们的轨道，在轴上直接添加 / 移动帖子（预填历史内容或安排未来内容），直观看到内容分布的疏密与多个 NPC 之间的时间交错。纵轴维度可切换——从"按用户"切到"按话题"或"世界整体事件"。

**设定文档面板（Obsidian 范式）**：结构化的 wiki 式编辑器——文件夹树、双向链接、全文搜索。创作者编写和组织世界观设定文档，文档结构即索引结构，LLM 的 `list_lore` / `read_lore` 工具天然契合。

**LLM 面板（Cursor 范式）**：双向交互，三层操作粒度：
- **观测**：查看自动运转的 GM / Agent 的完整记录——prompt、工具调用链、思考过程、输出结果，可回放审计。
- **指挥 GM**：用户用自然语言对 GM 下达意图（"让这个话题热起来"、"给这几个 NPC 安排点互动"），GM 自行拆解为任务、组织 Agent 执行。用户不需要关心具体怎么拆——只给方向，GM 负责编排。
- **直接操作 Agent**：用户跳过 GM，自己拉起一个 Agent 执行具体任务（"让 alice 发一条关于今天比赛的吐槽帖"），适合需要精细控制的场景。

自动 GM、用户指挥 GM、用户直接操作 Agent 三者走同一套 Agent 工具范式和管理 API，只是触发源与编排粒度不同。

**控制台面板**：模拟器启停、时钟控制（暂停 / 调速 / 跳转）、任务队列监控、LLM 预算仪表盘、世界快照管理。

**NPC 设计器**：创建账号、编辑人设档案（性格 / 立场 / 文风 / 兴趣标签 / 活跃时段 / 行为概率参数）、设头像与横幅、批量建号。核心 NPC 与氛围账号均在此配置，是世界建设阶段的主要工作面板之一。

**社交图谱面板**：可视化的关注 / 互动关系网络图。创作者在此设置初始关注关系（谁关注谁）、查看账号间的互动密度，直观理解世界的社交结构。

**话题 / 议程管理面板**：创建、编辑、退场话题，设定热度生命周期（出现 → 发酵 → 峰值 → 退潮）。话题来源包括创作者手动创建、GM 注入、设定文件中的世界事件日程。

**内容池管理面板**：查看通用场景池与话题评论池的内容条目与水位，手动添加 / 清理条目，触发补水任务。

**数据统计面板**：帖量、互动量、话题分布、账号活跃度等图表，承接设计目标中的"高维观看"需求——以上帝视角观察世界运转的宏观态势。

**媒体库面板**：浏览管理世界中的所有图片 / 视频素材，按账号或时间筛选，支持拖拽到时间轴或 Composer 中使用。

**创作助手 Agent**：编辑器内置的 AI 助手，帮助创作者用自然语言建设世界。创作助手拥有与 GM / 任务 Agent 同一套工具（创建/删除/修改 NPC、设定关注关系、预填帖子、创建话题、安排预设事件等），创作者用对话式交互驱动——如"帮我创建 5 个关注科技话题的氛围账号"、"给 alice 和 bob 之间设计一段过去的争论"。创作助手与 GM 的区别在于服务对象：GM 服务于模拟运转的自动化，创作助手服务于创作者的手动世界构建。

帖子编写等具体操作复用社交网站的 UI 组件（Composer、PostCard 等），在熟悉的界面上叠加元数据编辑（指定发帖账号、时间戳等），用户无需学习一套全新交互。

#### 编辑器工程结构

编辑器作为独立工作区 `editor/` 加入 monorepo，内部前后端分离：

```
editor/
├── src/
│   ├── main/        # Electron 主进程（窗口管理、子进程生命周期）
│   ├── server/      # 编辑器后端（编辑器专属 API，如时间轴数据聚合、Agent 会话管理）
│   └── renderer/    # 编辑器前端（各面板 UI）
```

与 `client/`（社交网站前端）、`server/`（社交网站后端）、`simulator/`（模拟引擎）平级解耦。编辑器后端调用社交网站的 HTTP API 和模拟器接口，不直接访问数据库，保持各工作区职责清晰。

## 后续路线

### 桌面应用架构

项目最终形态为 Electron 桌面应用，三个进程：
- **Electron 主进程**：应用壳，管窗口与进程生命周期。
- **Fastify 服务端**：子进程，与当前独立运行的 dev:server 同一套代码。
- **模拟器**：另一个子进程，消费 HTTP API。

编辑器渲染在 Electron BrowserWindow 中。社交网站同时提供 Electron 内嵌窗口版本和外部浏览器访问版本（均指向 localhost）。模拟器完全不知道 Electron 的存在——它只认 HTTP API。Electron 是把三个组件打包在一起的壳，让非技术用户双击即用。

### 实施顺序

骨架与前端同步推进，每做一个模块就连带做对应的前端 / 编辑器 UI，一步一验收：

1. ~~**ECS 骨架 + tick 引擎最小闭环**~~（已完成，`d207697`）
2. ~~**世界管理与编辑**~~（已完成，`bb2342c`）
3. ~~**话题系统与互动级联**~~（已完成，`5dc8c68`）
4. ~~**LLM Agent 接入**~~（已完成，`e464dd9`）

M5-1~4 之上启动 `feat-M5-X-RE` 分支重启 M5-X 行为层：NPC 行为先做成零 LLM 的确定性层，按"先确定性后 LLM、编辑器为唯一观察窗逐里程碑同步"的四步阶梯推进（地基 → 顶层帖 → 配图 → 回复），行为状态机与下列 GM 导演层后置。Step 0a（代理建号）、0b（模拟器跟随活动世界 + 不存密码驱动）已完成。详见 `docs/m5-x-re-plan.md`。

5. **GM 导演层**：GM 唤醒控制器（四类触发条件）+ 任务分发 + 决策日志 + 预算降级 + 内容池补水。
6. **Electron 打包**：将服务端 + 模拟器 + 编辑器封装为桌面应用。

### 待办与技术债（无固定排期）

- 搜索从 LIKE 升级到 SQLite FTS5（search.repo 内替换查询即可，接口不变）。
- 自定义历法：world.json 的 calendar 目前仅是展示标签，修真历法等自定义纪年换算未实现。
- "后台世界继续流逝"模式：当前挂起世界一律冻结，可做成世界级选项。
- 前端移动端适配（当前为桌面三栏布局）。
- 生产构建与启动流程（当前仅 dev 模式：tsx watch + vite dev）。
- 通知的单条已读（当前仅支持全部已读）。
