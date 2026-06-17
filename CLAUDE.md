# NewSocialSim 交接说明

本地运行的社交媒体模拟器（仿 X/Twitter），全 TypeScript。两阶段计划：第一阶段是真实可用的社交网站（**已完成**，含完整媒体系统）；第二阶段以网站 HTTP API 为唯一接口构建模拟器（**M5-1 至 M5-4 已完成**：ECS tick 引擎 + 世界管理 + 话题/内容池 + LLM Agent 三厂接入；当前在 `feat-M5-X-RE` 分支重启 M5-X 行为层，先确定性后 LLM，Phase 0 地基已实施至 0.8（决策轨迹落 per-world SQLite + 编辑器重建为 Electron + 控制台世界/时钟/模拟器态），纲领见 `docs/m5-x-re-plan.md`、细步见 `docs/m5-x-roadmap.md`），虚拟用户与真人走相同 API。用途：观察娱乐 + 小说世界观创作辅助 + 信息传播研究。

## 运行

```powershell
npm install
npm run dev:server   # Fastify 后端 http://127.0.0.1:3000（tsx watch）
npm run dev:client   # Vite 前端 http://localhost:5173（/api 代理到 3000）
npm run dev:simulator # 模拟引擎（ECS tick，连接后端 API）
npm run dev:editor   # 世界编辑器（Electron 桌面程序，electron-vite；内置 Fastify 后端 :5176 连社交站）
npm run typecheck    # 五个工作区 tsc --noEmit
npm run gen:openapi -w @socialsim/server  # 改路由后刷新 OpenAPI 快照 docs/openapi/server.{json,yaml}
npm run gen:openapi -w @socialsim/editor  # 刷新 docs/openapi/editor.{json,yaml}
```

- **API 文档（OpenAPI 3.1）**：社交站 `http://127.0.0.1:3000/docs`、编辑器后端 `http://127.0.0.1:5176/docs`（Swagger UI，需起对应后端）；机器读 spec 与生成/设计说明见 `docs/openapi/`。
- 演示账号（"现代地球"世界）：alice / bob / carol / dave，密码均 `secret123`。
- 后端 API 回归脚本：`scripts/verify-m3.ps1`、`scripts/verify-dm.ps1`（私信，72 项断言）、`scripts/verify-m5.ps1`（admin/话题/内容池/快照/LLM，42 项断言）；均需后端已启动。

## 结构速览

npm workspaces monorepo：

- `shared/` — 前后端共用纯类型（贫血实体 + 视图类型 + API DTO），改接口先改这里。
- `server/` — Fastify + better-sqlite3。
  - `src/core/` 基础设施：`clock/`（SimClock 模拟时钟）、`db/`（连接 + 版本化 migration，当前 v14）、`world/`（WorldManager 多世界热切换 + 快照 + 时钟控制，含 onActivated 钩子）、`auth/`（JWT 密钥与 requireAuth/optionalAuth 守卫）、`events/`（SseHub：SSE 连接中枢，心跳/按用户推送/热切换清场）、`pagination.ts`（游标工具）。
  - `src/modules/` 按功能域分层，每模块四件套 `*.routes.ts / *.controller.ts / *.service.ts / *.repo.ts`：worlds、auth、users、posts、media（上传/外链入库/文件流，文件存各世界 media/ 目录）、media-search（七源关键字搜图 + Pixiv/B站 CDP 引导登录，凭证在 data/media-search.json）、link-cards（OG 链接卡片 + embed 嵌入推导，无路由）、tools（yt-dlp/ffmpeg 二进制管理，一键安装到 data/bin/）、video-search（外站视频搜索与引入：嵌入卡/下载/流式三形态、异步任务、流式 Range 代理、三搜索源）、interactions（赞/转发/书签/隐藏帖）、follows、blocks、timeline、notifications、search、messages（私信：1v1 会话/消息请求/已读回执/表情回应/SSE 流）、admin（管理端：代理建号(is_bot,拒绝 bot 命名)/登录票(login-as,凭 admin key 换 JWT)/代理发帖/批量关注/计数注水/话题CRUD/内容池/LLM配置/NPC档案/设定文件库/快照/Agent执行，admin key 认证）。
- `client/` — React 19 + Vite + Tailwind 4 + react-query + Remix Icon（均 npm 本地，离线可用）。
  - `src/api/` fetch 封装与全部接口；`src/auth|world|i18n|theme/` 四个全局 Context；`src/components/` 通用组件（Layout、PostCard、Composer、usePagedQuery 等）；`src/features/<页面>/` 按页面组织。
- `simulator/` — 模拟引擎（独立进程，跟随活动世界，不持有任何特定世界数据）。
  - `src/simulator.ts` 编排器：启动只读基础设施配置，运行时查 `GET /api/admin/worlds/active` 跟随活动世界，世界变更则 flush→重登账号（login-as 票据，不存密码）→重建系统；被驱动账号 = 有 npc 档案者，驱动配置取自 npc-profiles.json。tick 在世界模拟时间下运行。`src/ecs/` Entity/Component/System 框架；`src/systems/` PostingSystem（确定性发帖：话题感知+内容池，LLM 路径已移出关键链路）、InteractionSystem（概率互动）、CascadeSystem（级联反应）；`src/llm/` LLMProvider 抽象 + 三家实现 + agentic 循环 + 工具集（暂未接入关键路径，待行为状态机阶段）。
- `editor/` — 世界编辑器，Electron 桌面程序（electron-vite），三层 `src/main`（主进程，拉起并管编辑器后端子进程）/ `src/server`（Fastify 后端 :5176，renderer 唯一数据源，代理社交站 + 读 sim-trace.db + 布局存档）/ `src/renderer`（dockview 多窗格前端）。
  - 工作区为 Blender 式：每格 PaneHost 顶部下拉切面板类型（注册表见 `renderer/panels/registry.ts`，控制台已实现、其余占位），停靠走 dockview 原生 Adobe 式（拖标签到边缘分屏/合并/浮动/弹出窗口）；4 套预设布局 + 布局跟随世界存 `data/worlds/<id>/editor-layouts.json`。配色对齐 `docs/editor-mockup.html`。
- `data/worlds/<id>/` — 运行时数据（不入 git）：world.db（该世界全部数据）+ world.json（元数据与时钟状态）+ media/（该世界全部媒体文件）+ lore/（设定文档 .md）+ npc-profiles.json + content-pools.json + snapshots/（轻量快照）。
- `data/media-search.json` — 实例级搜图配置（不入 git，含 Pixiv refresh token、HTTP 代理、各源 API key）。本机已配置代理 127.0.0.1:7897 与 Pixiv 登录态。
- `data/llm-config.json` — LLM 多提供商配置（不入 git，含 API key）。每个提供商配置名称/来源/Base URL/Key/模型列表，High/Low-tier 全局选择。
- 文档：**新会话先读 `docs/m5-x-index.md`（M5-X 文档索引与阅读顺序，含代码进度速查）。** `docs/design.md`（设计决策、架构约束、M5 路线与待办）、`docs/server-api.md`（**全 server HTTP API 速查**，按域分组含方法/路径/鉴权/用途）、`docs/m5-design.md`（M5 模拟器设计独立副本——双层架构/Agent 工具范式/GM 生命周期/编辑器面板/实施顺序，供后续 LLM 直接阅读）、`docs/m5-account-model.md`（账号驱动模型——账号类型即默认驱动模式/四轴 + 降级地板/五预设/纯 LLM 退出确定性互动层/分库映射）、`docs/devlog/<日期>.md`（每日开发日志，新一天的工作结束后按既有格式追加一篇；当日内容多时主日志只留概要/周期一览/数据状态，细节拆到 `<日期>-<主题>.md` 子日志）、`plan.md`（最初的项目计划）。
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
- **原生模块（better-sqlite3）ABI**：dev 下 server/simulator 走 tsx（系统 node），编辑器后端由 Electron 主进程经 `child_process.fork` + 系统 node 拉起（**不用 utilityProcess**），三进程统一系统 node ABI，免 electron-rebuild。若改回 Electron 内置 node 跑后端，会因 `NODE_MODULE_VERSION` 不匹配读 sim-trace.db 失败。打包（M5-6）再改为「为 Electron 重建原生模块 + utilityProcess」。

## 工作惯例

- 每轮改动：`npm run typecheck` 全绿 →（动了前端）`npm run build -w client` → 用 Invoke-RestMethod 验证新后端接口 → git commit（中文、分类前缀 feat/fix/style/docs/chore）。
- UI 一律对照 X 现行样式实现；用户会给截图，参考项目 `参考文件/client` 可查具体样式参数。
- 视觉/交互由用户人工端到端验收，完成后等待反馈再继续。
- 用户的工作模式是逐项提出改进点，倾向先计划确认再动手。

## 下一步

- 当前主线：`feat-M5-X-RE` 分支，细步见 `docs/m5-x-roadmap.md`（四步阶梯展开为单提交级原子步）。**Phase 0 地基已全部完成 0.1–0.12**；时间轴完善 T.1/T.2/T.3/T.5 完成，**T.4（决策轨迹「为什么」postId 合并）已完成**、**T.6 部分完成（仅「选中账号只看其轨道」）**，余轴上编辑/轴维度切换押后。
- **Phase 1 顶层帖（内容池 ECS）已完成 1.0–1.4**（详见日志 `2026-06-18.md`）：1.0 TuningService（直读文件）/ 1.1 内容池三层 schema 与加载 / 1.2 组装引擎（混合式取片段 + 占位符 + 种子复现）/ 1.3 shape 过滤 / 1.4 PostingSystem 接组装（按 poolAffinities 选池→组装→发 standalone→轨迹带池·语法·模块）。**1.1b 话题拆分经勘察重新定性为「不拆不迁移、押后」**（topics 表非用户可见，详见 `docs/m5-x-phase1-baseline.md`「话题表定性」）。**下一步 1.5 氛围号水贴 → 1.6 内容池面板 / 1.7 NPC 设计器 / 1.8 块详情增强（编辑器面板）→ 1.9 端到端验收。** 状态机层、LLM 行为层、GM 导演层（M5-5）、Electron 整体打包（M5-6）顺延。
- **配置范式（Phase 1 起，见 `docs/m5-x-phase1-baseline.md`）**：模拟器用 `dataDir` 直读世界文件夹的配置文件（`data/global-config/defaults.json` + 全局原子池 `data/global-pools/` + 世界 `tuning.json` / `scene-pools` / `topic-pools`），social server **不经手**模拟器域配置；编辑器面板改配置经编辑器后端直接读写文件。`data/global-config` 与 `data/global-pools` 入 git，其余 `data/` 仍忽略。
- **时间轴是查看世界全部帖子与互动的面板、独立于模拟器**（按 `docs/m5-design.md` Premiere 范式）：块=世界真实内容（社交站全站流 + 按账号回复/互动），非决策轨迹；决策轨迹退为点开块后的"为什么"增强层（待 postId 合并）。早期"块=轨迹条"属偏离已校正——见 memory `read-design-docs-first`。
- 编辑器已从临时 UI 重建为 Electron + dockview 工作区（见结构速览）；十面板按 `docs/m5-design.md` 设计逐里程碑把注册表占位换成实现（控制台、时间轴、检视器已实现）。
- **全 server HTTP API 速查见 `docs/server-api.md`**（按域分组、含方法/路径/鉴权/用途；模拟器与编辑器后端都从这里查能力）。
- 媒体系统四期已全部完成，设计细节见 docs/design.md。虚拟用户发图帖链路已就绪：`GET /api/media-search` → `POST /api/media/from-url` → `POST /api/posts`。
- 未实现的大块：GM 导演层、Electron 打包、正式编辑器 UI、自定义历法换算、生产构建流程。
