
NewSocialSim 项目计划
Context
用户要在 i:\小说\NewSocialSim 从零构建一个本地社交媒体模拟器（仿 X/Twitter）。思路分两个阶段：

第一阶段：做一个真实、完整、可正常注册发帖的社交媒体网站（前端 + 后端）。
第二阶段：以该网站的 API 为接口，构建模拟器——虚拟用户像真人一样调用注册/发帖/点赞等 API，模拟器层不侵入网站代码。
项目用途三者兼有：观察娱乐（自己也能注册账号参与）、小说创作辅助（为不同世界观生成"活的"社交媒体）、研究实验（信息传播、舆论形成，需数据导出）。

目录现状：基本为空，仅有 .claude/ 和一个无关的旧项目 image_searcher/（不要动它）。根目录已有本次预先创建的 package.json、tsconfig.base.json、.gitignore 三个文件，计划批准后沿用并按需调整。

已确认的决策
决策点	结论
技术栈	全 TypeScript；后端 Fastify + better-sqlite3；前端 React + Vite + Tailwind CSS
架构风格	高内聚低耦合的模块化；贫血模型（实体为纯数据接口，逻辑在 service 层）；后端按功能域分层 MVC；第二阶段模拟器采用 ECS
多世界观	一个世界 = 一个文件夹（world.db + world.json），完全隔离；备份/平行宇宙 = 复制文件夹
世界切换	运行中热切换：模块不持有数据库连接，统一经 WorldManager.current() 获取上下文；JWT 内含 worldId，切换后旧 token 自动失效（401 → 前端回登录页）
虚拟时间	业务代码一律不用 Date.now()，注入 IClock；每个世界有独立时钟状态（当前模拟时间、流速、暂停），持久化在 world.json
内容生成	混合：先规则/模板驱动，定义 ContentGenerator 接口，后续接 LLM 直接替换实现（第二阶段）
界面语言	i18n 可切换（zh-CN / en），世界可配置默认语言
版本控制	git init，image_searcher/ 与 data/ 加入 .gitignore
整体结构
NewSocialSim/
├── package.json            # npm workspaces: shared, server, client, simulator
├── tsconfig.base.json
├── shared/                 # 共用纯类型定义（贫血实体：User, Post, World, ...）
├── server/                 # Fastify 后端
├── client/                 # React 前端（第一阶段后期）
├── simulator/              # 模拟引擎（第二阶段，本计划仅占位）
└── data/worlds/<id>/       # 运行时数据，不入 git
    ├── world.db
    └── world.json
后端模块结构（server/src/）
├── index.ts / app.ts       # 入口与组装，不含业务逻辑
├── config.ts
├── core/                   # 业务无关基础设施
│   ├── clock/              # IClock 接口 + SimClock（模拟时间 = 锚点 + 真实流逝 × 流速）
│   ├── db/                 # 连接封装 + 版本化 migration 运行器（PRAGMA user_version）
│   ├── world/              # WorldManager：list/create/activate/current，热切换核心
│   └── errors/             # 统一错误类型 → HTTP 状态码映射
└── modules/                # 每模块固定四件套：routes / controller / service / repo
    ├── worlds/             # 世界管理 API（无 repo，落到 WorldManager）
    ├── auth/               # 注册/登录，crypto.scrypt 哈希（不引 bcrypt 原生依赖），@fastify/jwt
    ├── users/              # 个人资料、查询
    ├── posts/              # 发帖/回复/引用/删除
    ├── interactions/       # 点赞/转发
    ├── follows/
    ├── timeline/           # 关注流 + 全站流（游标分页）
    ├── notifications/
    └── search/             # 关键词 + 话题标签（SQLite FTS5 或 LIKE 起步）
依赖方向严格单向：routes → controller → service → repo；跨模块只允许 service 调 service。

数据库 schema（migration v1）
users(id, handle UNIQUE, display_name, bio, password_hash, is_bot, created_at)
posts(id, author_id, content, reply_to_id, quote_of_id, created_at, like_count, repost_count, reply_count)（计数反规范化，由 service 维护）
likes(user_id, post_id, created_at)、reposts(...)、follows(follower_id, followee_id, created_at)
notifications(id, user_id, type, actor_id, post_id, read, created_at)
所有 created_at 写入的是 IClock 的模拟时间（unix ms 形式）。is_bot 字段为第二阶段虚拟用户预留。

关键设计：WorldManager 热切换
持有当前世界上下文 { worldId, db, clock, meta }；activate(id)：保存当前世界时钟状态 → 关闭连接 → 打开新世界 db → 跑 migration → 由 world.json 恢复时钟 → 原子替换上下文。
活动世界 id 记录在 data/state.json，重启后自动恢复。
未加载任何世界时，业务 API 返回 409，世界管理 API 始终可用。
world.json：{ id, name, description, locale, clock: { simTimeMs, scale, paused }, calendar: { label } }（calendar 仅展示用，如修真世界"天元历"）。
实施里程碑
M1 — 骨架与核心设施：monorepo（root 三文件已有）+ git init 首次提交 + shared 类型包 + server 骨架 + core（clock/db/world/errors）+ worlds 模块（GET 列表、POST 创建、POST /:id/activate、GET active 含当前模拟时间）。验收：创建两个世界并热切换，模拟时间按各自流速独立运行。

M2 — 用户与认证：auth + users 模块，JWT 绑定 worldId，切换世界后旧 token 失效验证。

M3 — 内容与互动：posts、interactions、follows、timeline、notifications、search 模块。全部 API 可用 curl 完整走通"注册→关注→发帖→回复→点赞→时间线→通知"。

M4 — 前端：React + Vite + Tailwind，仿 X 三栏布局，feature 文件夹组织（features/timeline 等），i18n（zh-CN/en），登录注册、时间线、发帖、帖子详情/对话串、个人主页、通知、搜索，以及一个简单的世界切换管理页。

M5（第二阶段，另行细化）：simulator 包，ECS 架构；人设组件、行为调度系统、ContentGenerator（模板版 → LLM 版）、上帝控制台（流速调节、批量造人、事件注入、统计图表）、数据导出 JSON/CSV。

M1–M3 每步以可运行、可验证为准；M4 完成后第一阶段交付。

验证方式
每个里程碑结束：npm run typecheck 全绿；启动 server，用 PowerShell Invoke-RestMethod 走通该里程碑的 API 场景脚本。
M1 专项：创建世界 A（流速 60×）与世界 B（流速 1×），热切换前后分别读 GET /api/admin/worlds/active，确认模拟时间独立推进、数据互不可见。
M2 专项：世界 A 登录拿 token → 切到世界 B → 携旧 token 请求应得 401。
M4：浏览器实际操作注册/发帖/互动全流程。