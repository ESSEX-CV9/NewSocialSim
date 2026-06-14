# NewSocialSim 交接说明

本地运行的社交媒体模拟器（仿 X/Twitter），全 TypeScript。两阶段计划：第一阶段是真实可用的社交网站（**已完成**，含完整媒体系统）；第二阶段以网站 HTTP API 为唯一接口构建模拟器（**M5-1 至 M5-4 已完成**：ECS tick 引擎 + 世界管理 + 话题/内容池 + LLM Agent 三厂接入），虚拟用户与真人走相同 API。用途：观察娱乐 + 小说世界观创作辅助 + 信息传播研究。

## 运行

```powershell
npm install
npm run dev:server   # Fastify 后端 http://127.0.0.1:3000（tsx watch）
npm run dev:client   # Vite 前端 http://localhost:5173（/api 代理到 3000）
npm run dev:simulator # 模拟引擎（ECS tick，连接后端 API）
npm run dev:editor   # 世界编辑器 http://localhost:5174（/api 代理到 3000）
npm run typecheck    # 五个工作区 tsc --noEmit
```

- 演示账号（"现代地球"世界）：alice / bob / carol / dave，密码均 `secret123`。
- 后端 API 回归脚本：`scripts/verify-m3.ps1`、`scripts/verify-dm.ps1`（私信，72 项断言）、`scripts/verify-m5.ps1`（admin/话题/内容池/快照/LLM，42 项断言）；均需后端已启动。

## 结构速览

npm workspaces monorepo：

- `shared/` — 前后端共用纯类型（贫血实体 + 视图类型 + API DTO），改接口先改这里。
- `server/` — Fastify + better-sqlite3。
  - `src/core/` 基础设施：`clock/`（SimClock 模拟时钟）、`db/`（连接 + 版本化 migration，当前 v14）、`world/`（WorldManager 多世界热切换 + 快照 + 时钟控制，含 onActivated 钩子）、`auth/`（JWT 密钥与 requireAuth/optionalAuth 守卫）、`events/`（SseHub：SSE 连接中枢，心跳/按用户推送/热切换清场）、`pagination.ts`（游标工具）。
  - `src/modules/` 按功能域分层，每模块四件套 `*.routes.ts / *.controller.ts / *.service.ts / *.repo.ts`：worlds、auth、users、posts、media（上传/外链入库/文件流，文件存各世界 media/ 目录）、media-search（七源关键字搜图 + Pixiv/B站 CDP 引导登录，凭证在 data/media-search.json）、link-cards（OG 链接卡片 + embed 嵌入推导，无路由）、tools（yt-dlp/ffmpeg 二进制管理，一键安装到 data/bin/）、video-search（外站视频搜索与引入：嵌入卡/下载/流式三形态、异步任务、流式 Range 代理、三搜索源）、interactions（赞/转发/书签/隐藏帖）、follows、blocks、timeline、notifications、search、messages（私信：1v1 会话/消息请求/已读回执/表情回应/SSE 流）、admin（管理端：代理发帖/批量关注/计数注水/话题CRUD/内容池/LLM配置/NPC档案/设定文件库/快照/Agent执行，admin key 认证）。
- `client/` — React 19 + Vite + Tailwind 4 + react-query + Remix Icon（均 npm 本地，离线可用）。
  - `src/api/` fetch 封装与全部接口；`src/auth|world|i18n|theme/` 四个全局 Context；`src/components/` 通用组件（Layout、PostCard、Composer、usePagedQuery 等）；`src/features/<页面>/` 按页面组织。
- `simulator/` — 模拟引擎（ECS tick + 内容生成 + 互动级联 + LLM Agent）。
  - `src/ecs/` Entity/Component/System 框架；`src/systems/` PostingSystem（话题感知+内容池）、InteractionSystem（概率互动）、CascadeSystem（级联反应）；`src/llm/` LLMProvider 抽象 + Claude/DeepSeek/Gemini 三家实现、AgentRuntime agentic 循环、工具集（12 个）、调度器。
- `editor/` — 世界编辑器（临时 UI，端口 5174）。
  - 六个 Tab 面板：Console（时钟控制/快照/世界管理）、Timeline（预填帖子）、Topics（话题管理）、Pools（内容池）、Lore（设定文档）、NPC Designer（人设档案）、LLM（提供商配置/Agent 触发/执行日志）。
- `data/worlds/<id>/` — 运行时数据（不入 git）：world.db（该世界全部数据）+ world.json（元数据与时钟状态）+ media/（该世界全部媒体文件）+ lore/（设定文档 .md）+ npc-profiles.json + content-pools.json + snapshots/（轻量快照）。
- `data/media-search.json` — 实例级搜图配置（不入 git，含 Pixiv refresh token、HTTP 代理、各源 API key）。本机已配置代理 127.0.0.1:7897 与 Pixiv 登录态。
- `data/llm-config.json` — LLM 多提供商配置（不入 git，含 API key）。每个提供商配置名称/来源/Base URL/Key/模型列表，High/Low-tier 全局选择。
- 文档：`docs/design.md`（设计决策、架构约束、M5 路线与待办）、`docs/m5-design.md`（M5 模拟器设计独立副本——双层架构/Agent 工具范式/GM 生命周期/编辑器面板/实施顺序，供后续 LLM 直接阅读）、`docs/devlog/<日期>.md`（每日开发日志，新一天的工作结束后按既有格式追加一篇；当日内容多时主日志只留概要/周期一览/数据状态，细节拆到 `<日期>-<主题>.md` 子日志）、`plan.md`（最初的项目计划）。
- `参考文件/` — 用户提供的参考项目（Vue 版 X 克隆，借鉴样式用）与其他资料，**只读，不入 git，不要修改**。

## 关键机制（动代码前必须知道）

- **虚拟时间**：业务代码一律不用 `Date.now()`，时间来自 `worldManager.current().clock.now()`（模拟时间，unix 毫秒形态）。每个世界有独立流速/暂停态，时钟快照定期写回 world.json。
- **多世界热切换**：模块不持有数据库连接，每次请求经 `WorldManager.current()` 取上下文。JWT 含 worldId，切世界后旧 token 全部 401。
- **依赖方向**：routes → controller → service → repo，跨模块只允许 service 调 service，repo 不互调；薄 routes/controller，逻辑在 service。
- **migration 只增不改**：schema 变更追加新版本号条目（`server/src/core/db/migrations.ts`）。
- **API 优先**：任何功能先有 API 再有界面——第二阶段虚拟用户只能走 API。
- **分页**：列表接口一律游标分页，响应 `{ items, nextCursor }`，游标是 base64url(JSON 数组)。
- **主题系统**：`client/src/index.css` 中 `[data-theme]` 变量块 + `@theme inline` 映射；组件只用 `bg-x-*` 等令牌类，禁止写死颜色。新主题 = 加一个变量块 + `client/src/theme/themes.ts` 注册。
- **多账号**：客户端 localStorage 存账号数组（token+快照），401 自动剔除失效账号。
- **i18n**：所有界面文案经 `useI18n().t(key)`，中英文案都在 `client/src/i18n/messages.ts`，新增文案必须双语。
- **媒体系统**：外部图片一律下载入库不热链；媒体文件 URL 带 `?w=<worldId>` 防跨世界缓存撞号；一条媒体只挂一处——帖子或私信消息（一帖 ≤20 个、一条消息 ≤4 个，图视频可混排，帖子卡只显示前 4 个）；外链抓取走 `core/safe-fetch.ts`（SSRF 防护）。Fastify 流式响应必须 `return reply.send(stream)`（async handler 竞争会吞空 body）。详见 docs/design.md。
- **私信与 SSE**：DM 不写 notifications 表（独立未读角标）；已读/未读/游标全基于消息 id 而非时间戳（模拟时钟可回拨）；SSE 流 token 走 query 验证（EventSource 带不了 header），SSE 路由必须 `reply.hijack()` 自管连接；世界热切换会 closeAll 全部 SSE 连接。详见 docs/design.md。
- 服务端读 JSON 文件须容忍 UTF-8 BOM（已有 readJsonFile 工具）。

## 环境注意（Windows + PowerShell 5.1）

- 写 .ps1 / 被 PS 读取的文件必须 **UTF-8 带 BOM**，否则中文按 GBK 解析乱码；写给 Node 读的 JSON 必须**无 BOM**。
- `$home`、`$global` 是 PS 内置变量，脚本里换名。
- 单个 PSCustomObject 的 `.Count` 返回空（PS6 才有），断言前用 `@()` 包装。
- git 多行中文提交信息：写入临时文件后 `git commit -F <file>`（here-string 内英文双引号会拆参数）。
- Vite 绑定 localhost（IPv6），探测用 `http://localhost:5173` 而非 127.0.0.1。
- 多部分上传验证用 `curl.exe -F`（`Invoke-RestMethod -Form` 是 PS6+ 才有）；流式接口的断言必须含 body 字节数。
- PS 5.1 不支持三元运算符与 `&&`；`Invoke-RestMethod` 直接发含中文的 JSON body 会乱码（验证脚本避免中文 body 或改用临时文件）。
- Node fetch 不走系统代理；外网访问（pixiv/pinterest 等）依赖 data/media-search.json 的 proxy 字段（undici 全局 ProxyAgent）。

## 工作惯例

- 每轮改动：`npm run typecheck` 全绿 →（动了前端）`npm run build -w client` → 用 Invoke-RestMethod 验证新后端接口 → git commit（中文、分类前缀 feat/fix/style/docs/chore）。
- UI 一律对照 X 现行样式实现；用户会给截图，参考项目 `参考文件/client` 可查具体样式参数。
- 视觉/交互由用户人工端到端验收，完成后等待反馈再继续。
- 用户的工作模式是逐项提出改进点，倾向先计划确认再动手。

## 下一步

- 短期：M5-1 至 M5-4 已完成（ECS 骨架/世界管理/话题内容池/LLM Agent 三厂接入）。下一步为 M5-5 GM 导演层（GM 唤醒控制器 + 任务分发 + 决策日志 + 预算降级）和 M5-6 Electron 打包。详见 docs/m5-design.md 实施顺序。
- 编辑器当前为临时验证 UI（端口 5174），正式编辑器按 docs/m5-design.md "世界编辑器"章节设计重做（Premiere 式时间轴/Obsidian 式设定编辑器/Cursor 式 LLM 面板等十面板）。
- 媒体系统四期已全部完成，设计细节见 docs/design.md。虚拟用户发图帖链路已就绪：`GET /api/media-search` → `POST /api/media/from-url` → `POST /api/posts`。
- 未实现的大块：GM 导演层、Electron 打包、正式编辑器 UI、自定义历法换算、生产构建流程。
