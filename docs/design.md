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
| 内容生成 | 混合：先规则 / 模板驱动，通过 ContentGenerator 接口预留，后续替换为 LLM 实现 |
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
│       │   ├── errors/     # AppError 体系
│       │   └── pagination.ts
│       └── modules/        # 每模块四件套 routes/controller/service/repo
│           ├── worlds / auth / users / posts / interactions
│           ├── follows / timeline / notifications / search
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

### 数据库 schema（当前 version 10）

- `users(id, handle UNIQUE NOCASE, display_name, bio, password_hash, is_bot, created_at, pinned_post_id, avatar_media_id, banner_media_id, verified, website, location, birth_date, profession, verified_at)` —— `verified` 为 'none'/'personal'/'org'（蓝标/金标，PATCH /api/users/me 自助设定，变更时以模拟时间打点 `verified_at`），`website` 为个人链接（存储时无协议自动补 https://），`location` 为自由文本地名（可虚构），`birth_date` 为 YYYY-MM-DD，`profession` 为专业类别 key（前端 i18n 映射展示）
- `posts(id, author_id, content, reply_to_id, quote_of_id, created_at, like_count, repost_count, quote_count, reply_count, view_count, deleted)`
- `likes(user_id, post_id, created_at)`、`reposts(...)`、`bookmarks(...)`、`hidden_posts(...)` —— 主键 (user_id, post_id)
- `follows(follower_id, followee_id, created_at)`
- `blocks(blocker_id, blocked_id, created_at)` —— 主键 (blocker_id, blocked_id)
- `notifications(id, user_id, type, actor_id, post_id, read, created_at)`
- `media(id, owner_id, type, file_name, mime, width, height, size_bytes, source, origin_url, created_at)`、`post_media(post_id, media_id, position)` —— 主键 (post_id, position)
- `link_cards(url PRIMARY KEY, title, description, image_media_id, site_name, status, fetched_at)` —— OG 元数据按 URL 缓存（失败也缓存）

所有 `created_at` 存储的是世界模拟时间（unix 毫秒形式）。`users.is_bot` 为第二阶段虚拟用户预留。计数字段（like_count 等）为反规范化，由 service 在事务内随互动维护；`view_count` 为曝光计数，由客户端经 `POST /api/posts/views` 批量上报（会话内去重），service 另留 `addViews(postId, delta)` 任意增量方法供未来管理端注入模拟浏览量。

屏蔽为单向隐藏：被屏蔽者的帖子/转发从屏蔽者的关注流、为你推荐、全站流、搜索、回复区消失，其互动产生的通知（含未读数）被过滤，推荐关注排除；个人主页时间线、书签与喜欢列表、帖子详情主体不过滤（主动访问场景）。`hidden_posts`（隐藏单帖）在相同范围生效。置顶为每用户一条（`users.pinned_post_id`），个人主页时间线排除置顶帖、由前端单独渲染在顶部。

媒体系统：文件存 `data/worlds/<id>/media/<mediaId>.<ext>`（世界自包含，复制文件夹即含全部媒体），路径每次经活动世界现算保证热切换安全。文件端点 `GET /api/media/:id/file?w=<worldId>` 公开（img 标签带不了 JWT）、支持 Range/206（视频拖进度条）并返回 immutable 缓存头，`?w=` 防止切世界后媒体 id 撞号造成浏览器缓存污染。一条媒体只能挂一个帖子（一帖最多 20 个媒体，图/视频可混排；帖子卡宫格只显示前 4 个、超出在第 4 格叠 "+N" 角标，全部媒体在大图查看器里滑动），头像/Banner 不占名额；纯媒体帖允许空文案；软删帖保留媒体文件与关联。外部图片（URL 引入/搜图）一律经 `POST /api/media/from-url` 下载入库不热链（safe-fetch 做 SSRF 防护与限量下载；i.pximg.net 等防盗链站点自动带 Referer）。正文首个 URL 在发帖时抓取 OG 元数据生成链接卡片（link_cards 表按 URL 缓存：成功条目永久缓存，失败条目在下次有帖引用同 URL 时重试；抓取带 Chrome UA、10s/2MB——YouTube 等重型页 og 标签在 ~650KB 处；B 站 og:image 自动剥 @WxH 低清后缀取原图；缩略图入库；有媒体的帖不显示卡片；抓取失败不阻断发帖）。媒体系统 A 图片地基 / B 视频 / C URL 引入+OG 链接卡片 / D 关键字搜图四期已全部完成。

关键字搜图（media-search 模块）：`GET /api/media-search?q=&source=` 七源（pinterest 匿名优先、pixiv、danbooru、gelbooru、yandere、pexels、wikimedia）统一候选格式，单源直查或全可用源并行；候选经 from-url 入库挂帖——虚拟用户（第二阶段）走同一组 API 即可"一次检索拿图发帖"。实例级配置在 `data/media-search.json`（读容忍 BOM、写无 BOM）：`proxy` 字段经 undici 全局 ProxyAgent 作用于本进程全部出站 fetch（取消代理需重启服务）；各源凭证按需配置，`GET /api/media-search/sources` 报告可用状态。Pixiv 登录采用 CDP 引导：服务端 spawn 本机 Chrome/Edge（独立调试端口 + 临时 profile）打开 OAuth PKCE 登录页，监听 `pixiv://` 回调自动换 refresh token，手动粘贴 code 兜底；不引入 Playwright、不写注册表。内容分级由世界设定 `WorldMeta.contentRating`（safe/all，旧世界缺省 safe）映射到各源过滤参数，R-18G 另由实例配置 `pixiv.allowR18G` 把门。防盗链站点预览经 `GET /api/media-search/preview?url=`（白名单 host）代理。

### 关键机制

**虚拟时钟**：`模拟时间 = 锚点模拟时间 + (真实流逝) × 流速`。调速 / 暂停前先把"此刻"固化为新锚点，保证时间连续。时钟快照每 30 秒落盘到 world.json，进程异常退出最多丢失该间隔。前端按同一公式本地推算并每 60 秒与服务端校准。

**世界热切换**（WorldManager.activate）：先就绪新世界（读元数据 → 开数据库 → 跑 migration），成功后才保存旧世界时钟、关闭旧连接、原子替换上下文、记录活动世界 id。失败不影响当前世界。

**登录态与世界绑定**：JWT 负载为 `{ sub: 用户id, worldId, handle }`。守卫在验签后核对 worldId 与活动世界，不一致返回 401；前端收到 401 即清除 token 回登录页。

## 后续路线

### M5 模拟器（第二阶段主体）

simulator 工作区将采用 ECS 架构，通过 HTTP API 操作网站：

- **Entity**：虚拟用户（在网站侧注册为 `is_bot` 账号）。
- **Component**：人设档案（兴趣标签、性格、立场倾向）、活跃时段、行为概率参数（发帖 / 回复 / 点赞 / 关注频率）、情绪状态。
- **System**：每个调度 tick 运行的发帖系统、浏览互动系统、关注系统、情绪 / 话题传播系统。
- **ContentGenerator 接口**：第一版为模板 / 语料库实现（行为先跑通），第二版为 LLM 实现（按人设生成发帖与回复），两版可直接替换。
- **上帝控制台**：调节时钟（暂停 / 恢复 / 调速 / 设定时间）、批量造人、事件注入（"某话题突然爆了"）、全局统计图表。
- **数据导出**：帖子 / 互动 / 传播链导出 JSON / CSV。

### M5 之前需补的后端能力

- 世界时钟控制 API（暂停 / 恢复 / 调速 / 设定时间）：SimClock 已实现全部方法，缺路由暴露。
- 批量注册 / 管理虚拟用户的管理端 API（绕过密码登录为虚拟用户签发 token，或为模拟器提供管理密钥）。

### 待办与技术债（无固定排期）

- 搜索从 LIKE 升级到 SQLite FTS5（search.repo 内替换查询即可，接口不变）。
- 自定义历法：world.json 的 calendar 目前仅是展示标签，修真历法等自定义纪年换算未实现。
- "后台世界继续流逝"模式：当前挂起世界一律冻结，可做成世界级选项。
- 前端移动端适配（当前为桌面三栏布局）。
- 生产构建与启动流程（当前仅 dev 模式：tsx watch + vite dev）。
- 通知的单条已读（当前仅支持全部已读）。
