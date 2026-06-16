# M5-X 施工路线图

确定性四步阶梯（地基 → 顶层帖 → 配图 → 回复）展开为单提交级原子步，每步可独立验收、独立交接。模拟器侧每长出一段逻辑，编辑器同步长出能观察该逻辑的面板或控件。状态机层、GM 导演层、Electron 整体打包只列粗线条占位，跑通确定性四步后再展开。

## 阅读约定

- `✅` 已完成，`⬜` 待实现。
- 每步含四字段：**目标**（这一步交付什么）/ **改动**（碰哪些工作区与文件）/ **验收**（打开编辑器或网站一眼能判定对不对的可观测断言）/ **交接提示**（接手 LLM 需先知道的范式与坑）。
- 步骤编号 `阶段.序号`，序号即推进顺序，后序步默认依赖前序步的产出。

## 贯穿约束（每步都须遵守）

- 分库原则：数据进哪个库看"真人用户会不会有这份数据"。会有（账号 / 帖 / 关注 / 互动 / 媒体 / 私信，NPC 身份层即此处普通账号）→ 进 server 独占的 `world.db`、经 API 读写。不会有（模拟器操控 NPC 的内部机关）→ 单开模拟器独占的 per-world 库、绝不进 `world.db`：NPC 数值与运行时态进 `data/worlds/<id>/npc-state.db`，决策轨迹与 GM/Agent 决策日志进 `data/worlds/<id>/sim-trace.db`（各一张表，GM/Agent 日志每条同时记现实时间与世界时间）；两库随世界文件夹走、模拟器写、编辑器后端经 WAL 只读。双重身份实体（如话题）按字段拆：用户可见部分（话题名 / 展示热度）进 `world.db`，导演编排元数据（热度生命周期 / 池绑定 / GM 注入计划）归模拟器侧。
- 可调值（衰减率 / 系数 / 阈值 / 概率 / 权重）从写下第一行起取自 TuningService（全局 `data/global-config/defaults.json` + 世界级 override deep-merge），不得作为字面量写进 `.ts`。
- 业务时间一律取世界模拟时间（模拟器侧为 `simulator.ts` 的 `simNow()`，服务端为 `worldManager.current().clock.now()`），不得用 `Date.now()` 表达业务时间。
- 给 Node 读的 JSON 写盘无 BOM；给 PowerShell 读的 `.ps1` 与其读取文件写盘 UTF-8 带 BOM。
- 内容形态忠实：顶层发帖只取 `shape=standalone`，回复动作只取 `shape=reply`，引用动作只取 `shape=quote`；标注为回复的内容不得当顶层帖发出，反之亦然。
- 账号模型统一：虚拟账号经管理端代理建号、设 `is_bot=1`；`handle` / `displayName` / `id` 须拟真，禁止 `sim_` / `_amb` / `bot` / `npc` / 通用 stem+序号等暴露虚拟身份的命名。公共 API 响应不含 `isBot`。
- 喂 LLM 的任何内容剥除 `is_bot` 及一切真人 / NPC 可区分标记（LLM 行为层阶段生效，前期确定性层不涉 LLM）。
- 每轮改动：`npm run typecheck` 全绿 →（动前端）对应工作区 `build` → 用 Invoke-RestMethod 验证新后端接口 → 中文分类前缀提交。

---

## Phase 0 · 地基

模拟器跟随活动世界、代理建号、决策轨迹落盘与实时推送、编辑器重建为 Electron 多窗格形态（控制台 + 最小时间轴）。本阶段交付后，切换活动世界的全过程在编辑器中可见，模拟器每次写世界都在时间轴上留块。

### 0.1 代理建号 ✅

- **目标**：管理端创建 `is_bot=1` 虚拟账号，拒绝暴露虚拟身份的命名。
- **改动**：`server/src/modules/admin/`（`POST /api/admin/users`）、`simulator/src/api-client.ts`（`adminCreateUser`）。
- **验收**：拟真建号返回 201 且 DB `is_bot=1`；重复 handle 返回 409；命名违规（`sim_` / `bot` / 序号后缀等）返回 400。

### 0.2 跟随活动世界 + 不存密码驱动 ✅

- **目标**：模拟器运行时查活动世界并跟随热切换，凭 `login-as` 票据驱动账号，任何地方不存明文密码。
- **改动**：`simulator/src/simulator.ts`（编排器）、`config.ts`（仅基础设施字段）、`server` admin（`POST /api/admin/login-as`）。
- **验收**：网页端切世界后模拟器自动 flush 旧世界、重登新世界 npc、用新配置运转，全程不重启进程、无对旧世界写入。

### 0.3 决策轨迹落盘 ✅

- **目标**：定义决策轨迹事件结构，模拟器每次写世界（发帖 / 回复 / 引用 / 赞 / 转 / 关注）写一条到该世界独占的 `sim-trace.db`，作为可审计的持久真相源。
- **改动**：`shared/src/types/trace.ts`（新增 `SimTraceEvent` 类型并在 `shared/src/index.ts` 导出）；`simulator/` 加 `better-sqlite3` 依赖；`simulator/src/` 新增轨迹 sink 模块（按当前活动世界打开 `data/worlds/<id>/sim-trace.db`，WAL，`CREATE TABLE IF NOT EXISTS trace_event` + `PRAGMA user_version`，索引 `sim_time` 与 `(entity, sim_time)`，每事件一行 insert）；切世界时关旧库连接、开新库；`PostingSystem` 等写世界处调用 sink 吐事件。
- **验收**：在 `demo` 世界跑模拟器，用 sqlite 查 `data/worlds/demo/sim-trace.db` 的 `trace_event` 表，每行含 `at` / `sim_time` / `entity` / `action` / `shape` / `pool_id` 等列，行数随发帖增长，按 `sim_time` 区间查询命中索引。
- **交接提示**：分库原则——`sim-trace.db` 模拟器独占、绝不进 `world.db`。`better-sqlite3` 已在 monorepo（server 用），引入零新依赖。WAL 模式供编辑器后端跨进程并发只读。事件字段以 `docs/m5-x-re-plan.md`「决策轨迹」节为准（`at` 真实时间、`simTime` 模拟时间、`entity` handle、`action`、`activityState`、`intent`、`shape`、`poolId`、`entryId`、`mediaAttached`、`mediaReason`、`targetPostId`）。Step 0 阶段 `intent` / `activityState` 可填占位值（如 `earnest` / `null`），后续状态机阶段补真值。

### 0.3b GM/Agent 决策日志归位 ✅

- **目标**：决策日志的"家"从社交站 server 进程内存迁到 `sim-trace.db`，债务不留待后续阶段。
- **改动**：`simulator/src/` 轨迹 sink 模块在 `sim-trace.db` 增 `gm_agent_log` 表（`CREATE TABLE IF NOT EXISTS`，每行同时记 `at` 现实时间 + `sim_time` 世界时间，索引 `at`）；删除 `server/src/modules/admin/admin.service.ts` 的 `agentLogs` 内存数组与 `GET/POST /api/admin/agent-logs` 的存储职责（其唯一消费方是临时编辑器 LlmPanel，与 0.4 删临时编辑器同步清理）；`shared/src/types/trace.ts` 加日志事件类型。
- **验收**：server 不再持有任何 GM/Agent 日志内存态；日志唯一落点是 `sim-trace.db` 的 `gm_agent_log` 表，编辑器后端只读该表。
- **交接提示**：当前确定性阶段无 LLM agent 运行，本步只把家建在正确位置 + 拆除 server 错放的债；待 LLM 行为层 / GM 导演层回归时由模拟器写入此表，届时无需再迁移。现 `agentLogs` 用 `Date.now()` / 上限 100 / 重启即丢，整体删除不保留。分库原则：日志属观测线，绝不进 `world.db`。

### 0.4 编辑器 Electron 骨架 ✅

- **目标**：编辑器重建为 Electron 桌面程序三件套骨架，`npm run dev:editor` 拉起 Electron 窗口而非浏览器标签页。
- **改动**：删除现 `editor/src/` 单窗口标签页实现（`App.tsx` + `panels/`）；新建 `editor/src/main/`（Electron 主进程：建 BrowserWindow、管编辑器后端子进程生命周期）、`editor/src/server/`（Fastify 后端：`/health` + 透传 `GET /api/admin/worlds/active` 一个只读端点）、`editor/src/renderer/`（前端入口）；改 `editor/package.json` 脚本与依赖（加 electron、electron 构建链）、`editor/vite.config.ts`。
- **验收**：执行 `npm run dev:editor` 弹出 Electron 窗口；窗内能从编辑器后端取到当前活动世界 id。
- **交接提示**：旧临时编辑器整体废弃，不保留、不迁移其面板代码。编辑器后端是 renderer 的唯一数据源，renderer 不直接访问数据库、不绕过后端直连社交站 server。社交站 `server` 与 `simulator` 当前仍各自 `dev:server` / `dev:simulator` 单跑，Electron 连它们；三者整体打包进 Electron 留至 M5-6。开发期 Electron 加载 vite dev server，保留热重载。

### 0.5 多窗格壳 ⬜

- **目标**：renderer 实现可拖拽 / 分割的多窗格布局与面板注册表，面板按注册表挂载，空面板占位。
- **改动**：`editor/src/renderer/`（窗格布局组件、面板注册表、空面板占位）。
- **验收**：Electron 窗内出现可拖拽、可上下左右分割的窗格区；面板注册表注册一个占位面板即在窗格内可选可挂。
- **交接提示**：布局形态对标 IDE / Premiere（同屏并列多面板，如时间轴 + 轨迹详情 + 检视器）。后续每个里程碑的面板都注册进此注册表，不另起页面路由。

### 0.6 控制台·读态 ⬜

- **目标**：控制台面板展示当前活动世界与时钟状态（流速 / 暂停态 / 当前模拟时间）。
- **改动**：`editor/src/server/`（聚合 `GET /api/admin/worlds/active` 等只读端点）、`editor/src/renderer/`（控制台面板）。
- **验收**：控制台显示当前 `demo` 世界名与时钟；网页端切到另一世界后控制台显示随之更新。

### 0.7 控制台·时钟控制 ⬜

- **目标**：控制台可暂停 / 恢复 / 调速 / 跳转世界时钟。
- **改动**：`editor/src/server/`（透传时钟控制 admin 端点）、`editor/src/renderer/`（控制台控件）。
- **验收**：控制台点暂停后，网页端时间线时钟停摆、模拟器停止 tick；调速后流速即时变化。
- **交接提示**：时钟控制 admin 端点已存在（WorldManager 的时钟控制），编辑器后端透传即可，不在编辑器侧重新实现时钟。

### 0.8 控制台·模拟器状态 ⬜

- **目标**：模拟器上报运行态（当前绑定世界 / 登录账号数 / 上次 flush 的世界与时刻），控制台展示，使切世界过程可见。
- **改动**：`simulator/src/simulator.ts`（上报状态）、`server` admin（扩展现有 `GET /api/simulator/status`）、`editor/src/renderer/`（控制台状态区）。
- **验收**：网页端切世界时，控制台依次显示模拟器 flush 旧世界、绑定新世界、登录新世界 N 个账号。
- **交接提示**：`GET /api/simulator/status` 已存在且免鉴权供编辑器轮询，扩展其返回字段即可，避免新增端点。

### 0.9 编辑器后端·轨迹接入 ⬜

- **目标**：编辑器后端开只读连接读活动世界的 `sim-trace.db`，提供按模拟时间区间查询接口与一条 SSE 推流端点（先空推）。
- **改动**：`editor/src/server/`（以 `better-sqlite3` 只读连接打开 per-world `sim-trace.db`，`GET /trace?from&to` 走 `sim_time` 区间 SQL 查询 + `GET /trace/stream` SSE）。
- **验收**：curl 编辑器后端 `GET /trace`，拿到 `demo` 世界已落盘的轨迹事件数组，区间参数命中索引、返回正确子集。
- **交接提示**：`sim-trace.db` 是真相源、模拟器独占写，编辑器后端只读不写（WAL 下可与模拟器并发）。后端与世界文件夹同机，直接开库即可，不经社交站 server 中转。SSE 端点须自管连接（参考社交站 `core/events/SseHub` 的连接范式）。

### 0.10 最小时间轴面板 ⬜

- **目标**：时间轴面板纵轴为账号轨道、横轴为模拟时间，轨迹事件落为块，点开块展示该条决策详情。
- **改动**：`editor/src/renderer/`（时间轴面板，消费 `GET /trace` 与 SSE）。
- **验收**：打开时间轴看到 `demo` 三账号的发帖块按模拟时间排布；点开任一块显示 `entity` / `action` / `shape` / `poolId` 等字段。
- **交接提示**：决策轨迹视图与时间轴是同一面板——每条轨迹即一个块，不另做独立滚动日志。

### 0.11 轨迹实时推送 ⬜

- **目标**：模拟器每写一条轨迹即推送到编辑器后端 sink，后端经 SSE 转发，时间轴实时长块。
- **改动**：`simulator/src/config.ts`（加基础设施字段 `traceSinkUrl`，与世界无关）、`simulator/src/` 轨迹 sink 模块（落盘同时 POST 到 sink）、`editor/src/server/`（轨迹 ingest 端点 + 转发至 SSE）。
- **验收**：模拟器运转时，时间轴无需刷新即实时冒出新块。
- **交接提示**：sink 地址属基础设施配置，进模拟器启动参数；sink 缺失时模拟器仍独立运行，仅本地落盘不推流，不得因 sink 不可达而中断写世界或崩溃。

### 0.12 Step 0 端到端验收 ⬜

- **目标**：在全新创建的世界上跑通切世界端到端场景的可观测断言。
- **改动**：`scripts/`（新增验收脚本，经 API 现建世界、跑完清理，不依赖任何预置世界）。
- **验收**：脚本经 API 建 W1 并激活、代理建号、写最小配置、启动模拟器；激活 W2 后断言模拟器 flush W1、停驱动 W1、重登 W2、用 W2 配置发帖，全程无 401 空转、无对 W1 写入；激活回 W1 后恢复驱动；全程控制台状态与时间轴换流可见；DB 中驱动账号全 `is_bot=1` 且命名拟真。
- **交接提示**：脚本生成的 `.mjs` 含中文须用 ASCII 或 `\u` 转义以避开 tsx 动态导入预扫描 bug。PS 5.1 直接发含中文 JSON body 会乱码，验证脚本避免中文 body 或用临时文件。

---

## Phase 1 · 顶层帖（内容池 ECS 落地）

内容池从扁平 `string[]` 重做为与 ECS 同构的三层（组件类型 → 语法 → 池），模拟器按人设从池组装并发顶层帖，编辑器长出内容池面板与 NPC 设计器。本阶段交付后，时间线全是顶层帖、每个时间轴块可追溯到账号 · 池 · 语法 · 模块。

### 1.0 最小 TuningService ⬜

- **目标**：实现加载全局 defaults + 世界级 override 并 deep-merge 的 TuningService，提供 `get(path)`，先供内容池组装权重取值。
- **改动**：`data/global-config/defaults.json`（初稿，至少含 `pools` 命名空间的权重）、`simulator/src/`（TuningService：加载、deep-merge、`get`）；世界级 override 读 `data/worlds/<id>/tuning.json`。
- **验收**：内容池组装的语法权重 / slangDensity / novelty 系数全部经 `tuning.get(...)` 取得，代码中无对应字面量；写一个世界 `tuning.json` override 某系数，组装行为随之变化。
- **交接提示**：这是完整 Tuning 层（M5-X.0）的最小子集，后续在状态机阶段补全 `evalDerive` / `reload` / `onChange` 与编辑器 Tuning 面板。命名空间结构以 `docs/m5-npc-state-machine.md`「Tuning 配置层」节为准，本步只落 `pools` 一组。世界级配置供给方式（经 server admin 端点 vs 模拟器按活动世界 id 直读文件）取与 npc-profiles 一致的范式优先；若 API 表面膨胀过快，再改为直读世界文件夹。

### 1.1 内容池三层 schema 与加载 ⬜

- **目标**：定义组件类型库 / 语法库 / 池的结构类型，实现三类布局加载（全局原子池 + 世界场景池 + 临时话题池）。
- **改动**：`shared/src/types/`（`PoolComponent` / `Grammar` / `Pool` 类型）；`data/global-pools/`（基础原子池，入 git）、`data/worlds/<id>/scene-pools/`、`data/worlds/<id>/topic-pools/`；组件类型库与语法库按「全局共享 / 世界级」两层存放（全局层入 git）；`simulator/src/`（池加载器，按活动世界合并三类来源）。
- **验收**：加载 `demo` 的场景池解析为「组件类型 + 语法 + 池维度」结构，typecheck 全绿。
- **交接提示**：组件类型自带候选片段库；语法有序引用组件类型、每槽可标 `optional` 或 `prob`；池由维度（全局固定 `形态` + 世界自定义 `领域` / `作品` / `模式`）定义并声明引用哪几套语法及权重。槽位平等，无 opener / body / tail 特权角色。模型细节以 `docs/m5-x-re-plan.md`「内容池模型」节为准。

### 1.1b 话题拆分 ⬜

- **目标**：`world.db` 的 `topics` 表按分库原则拆分，导演编排元数据移出 `world.db` 归模拟器侧——趁话题刚进选题链路时归位，不养肥 `world.db` 后再拆。
- **改动**：`server` 的 `world.db` `topics` 表收敛为用户可见字段（话题名 + 展示热度等真人可见列），新增 migration（只增不改，现 v14）；话题↔专属池绑定、选题用兴趣标签、热度/议程编排元数据移到模拟器侧（配置随世界文件夹，`topic-pools` 文件即天然载体）；`simulator/src/systems/posting-system.ts` 选题改为读"`world.db` 可见话题 + 模拟器侧话题元数据"。
- **验收**：`world.db` `topics` 表只剩真人可见字段；模拟器选题用的池绑定 / 标签 / 编排从模拟器侧加载；编辑器话题面板能分别编辑两侧。
- **交接提示**：随 1.1 `topic-pools` 一并做。本步只做结构性拆分与存储归位——完整热度生命周期曲线属 GM/议程层、此处不必实现，只需把 `heat` / `tags` 中的"导演用途"挪出 `world.db`，用户可见的展示值可留。

### 1.2 组装引擎 ⬜

- **目标**：实现零 LLM 的内容组装：按池选一套语法 → 逐槽过滤并加权取片段 → 解析内联占位符 → 输出一条文本，给定 RNG 种子可复现。
- **改动**：`simulator/src/`（assembler 模块：语法加权抽选、可选槽 / prob 判定、片段加权、占位符解析）。
- **验收**：dev 脚本喂一个池连出 N 条，多数不重样且无病句；占位符解析不到匹配项时丢弃该候选片段重抽，不输出残缺占位符。
- **交接提示**：占位符 `{key}` / `{key:variant}` 即内联组件引用，与槽位同一机制。权重系数（alignmentMatch / novelty / topicRelevance）取自 tuning，本阶段 alignment 相关可中性化（待 Phase 状态机层接真值）。

### 1.3 shape 维度过滤 ⬜

- **目标**：池 / 语法 / 片段带 `形态` 维度，组装入口按动作过滤，本步只放行 `standalone`。
- **改动**：`simulator/src/`（组装入口加 shape 过滤）、内容池数据补 `形态` 维度。
- **验收**：顶层发帖只组装出 `standalone` 内容，无 reply / quote 形态的片段被当顶层帖发出。

### 1.4 PostingSystem 接组装引擎 ⬜

- **目标**：发顶层帖改为按 NPC 的 factions / poolAffinities 选池、经组装引擎产文、发 `standalone` 帖，并吐含池 · 语法 · 模块的轨迹。
- **改动**：`simulator/src/systems/posting-system.ts`（替换现扁平 `string[]` 的 `pickContent`，接组装引擎）；轨迹事件填 `poolId` / `entryId`（语法与所选片段标识）。
- **验收**：时间线全是顶层帖；时间轴每个块点开可追溯到 账号 · 池 · 语法 · 所选模块。
- **交接提示**：现 `PostingSystem` 用 `scenePools` / `topicPools` / `fallbackPool` 三档扁平字符串，本步整体替换；`simulator.ts` 构造 `PostingSystem` 处的 `DEFAULT_FALLBACK_POOL` 参数随之调整或移除。保持「获取不到内容则跳过本次发帖、不崩」的降级行为。

### 1.5 氛围号水贴 ⬜

- **目标**：氛围账号从基础原子池发低信息量水贴，承担「人气底噪」。
- **改动**：`simulator/src/systems/posting-system.ts`（按 tier 区分核心 / 氛围取池）、`data/global-pools/`（通用灌水池）。
- **验收**：时间线出现通用水贴且形态为 `standalone`，与核心账号的场景帖可区分密度。

### 1.6 内容池面板 ⬜

- **目标**：编辑器内容池面板可编辑维度定义、多槽位语法、组件集与片段，并实时预览组装结果。
- **改动**：`editor/src/server/`（池读写端点，落世界文件夹 / 全局层）、`editor/src/renderer/`（内容池面板 + 预览）。
- **验收**：在面板编辑一个池并点预览，即时看到该池组装出的若干条文本；保存后模拟器下次刷新池即采用新定义。
- **交接提示**：现 `POST/GET/DELETE /api/admin/content-pools` 为扁平 `string[]` 模型，已被三层模型取代，本步面板对接三层池的读写端点（随 1.1 加载器配套的端点）。

### 1.7 NPC 设计器面板 ⬜

- **目标**：编辑器创建账号并编辑人设（factions / poolAffinities / 活跃时段 / 行为概率），写入 NPC 文件并灌进 DB。
- **改动**：`editor/src/server/`（建号 + npc-profiles 读写透传）、`editor/src/renderer/`（NPC 设计器面板）。
- **验收**：在面板建号 → DB `is_bot=1` 且命名拟真 → 模拟器下次切世界 / 刷新即驱动该账号按其 factions 发帖。
- **交接提示**：建号走 `POST /api/admin/users`，人设走 `PUT /api/admin/npc-profiles/:userId`。被驱动账号 = 有 npc 档案者。文件为准、DB 为副本：作者基线写文件，开世界灌 DB。

### 1.8 时间轴块详情增强 ⬜

- **目标**：时间轴块详情展示 池 · 语法 · 模块 · shape 的完整追溯链。
- **改动**：`editor/src/renderer/`（块详情视图扩展字段）。
- **验收**：点开任一发帖块，看到它用了哪个池、哪套语法、填了哪些模块片段、形态为何。

### 1.9 Step 1 端到端验收 ⬜

- **目标**：在全新世界上断言顶层帖闭环。
- **改动**：`scripts/`（验收脚本，现建世界、跑完清理）。
- **验收**：现建世界、建号、写三层内容池与 npc-profiles、启动模拟器；运转一段模拟时间后，时间线全是顶层帖无错位回复，每个时间轴块可追溯到账号 · 池 · 语法 · 模块。

---

## Phase 2 · 配图

发顶层帖按场景自然引入媒体，链路复用网站既有的搜图 → 入库 → 携带 mediaIds 能力，获取失败降级纯文本。编辑器轨迹块标注配图原因，并长出媒体库面板雏形。

### 2.1 媒体决策 ⬜

- **目标**：发帖按场景与概率决定是否配图、配几张，决策参数取自 tuning，轨迹记 `mediaReason`。
- **改动**：`simulator/src/systems/posting-system.ts`（配图决策）、`data/global-config/defaults.json`（`media` 命名空间：配图概率 / 单帖上限 / 源偏好）。
- **验收**：轨迹事件 `mediaAttached` / `mediaReason` 反映决策（如「scene=coser 命中配图概率」）。

### 2.2 媒体链路 ⬜

- **目标**：模拟器像真人一样配图：搜图 → 入库 → 携带 mediaIds 发帖，失败降级纯文本。
- **改动**：`simulator/src/api-client.ts`（搜图 / `POST /api/media/from-url` / 带 mediaIds 发帖）、`posting-system.ts`（串联链路与降级）。
- **验收**：时间线部分帖图文相称，`GET /api/media/:id/file` 返回非空字节；媒体获取失败的帖降级为纯文本且仍发出。
- **交接提示**：媒体链路为 `GET /api/media-search` → `POST /api/media/from-url` → `POST /api/posts`（带 mediaIds），网站既有能力已就绪。媒体内容分级由世界 `contentRating` 经服务端 media-search 把门，模拟器不重复实现分级。一帖 ≤20 个媒体。

### 2.3 NPC 优先媒体池 ⬜

- **目标**：NPC 可有专属优先媒体池（私有 `media/`），发图帖优先取，使其图帖风格一致。
- **改动**：`data/worlds/<id>/npcs/<handle>/media/`、`simulator/src/`（发图时优先私有池再退回搜图）。
- **验收**：配了优先媒体池的 NPC，其图帖稳定取自该组图。

### 2.4 轨迹块标注配图原因 ⬜

- **目标**：时间轴块展示配图原因。
- **改动**：`editor/src/renderer/`（块详情显示 `mediaReason` 与媒体缩略）。
- **验收**：点开带图的块，看到配图原因与所配媒体。

### 2.5 媒体库面板雏形 ⬜

- **目标**：编辑器浏览世界全部媒体。
- **改动**：`editor/src/server/`（媒体列表透传）、`editor/src/renderer/`（媒体库面板）。
- **验收**：面板按账号 / 时间浏览世界媒体素材。

### 2.6 Step 2 端到端验收 ⬜

- **目标**：在全新世界上断言配图闭环。
- **验收**：现建世界跑通后，时间线至少一条帖按场景携带入库媒体且 `file` 字节非空，配图失败路径降级为纯文本。

---

## Phase 3 · 回复

NPC 回复前帖、回复楼中楼、引用，形态正确且内容贴合被回复帖。编辑器对话串视图可见回复挂对父帖，轨迹块标注回应了哪条、用了哪个 reply intent。

### 3.1 reply 形态池与过滤 ⬜

- **目标**：内容池补 `reply` / `quote` 形态，回复动作只组装 `reply`、引用动作只组装 `quote`。
- **改动**：内容池数据补 reply / quote 形态片段、`simulator/src/`（按动作放行对应 shape）。
- **验收**：回复动作产出的内容均为 reply 形态，不出现顶层帖片段被当回复发出。

### 3.2 回复目标选择 ⬜

- **目标**：NPC 浏览时间线按兴趣选一条被回复帖，回复挂对父帖。
- **改动**：`simulator/src/systems/`（回复目标选择 + 调 reply 端点带 `replyToId`）、轨迹填 `targetPostId`。
- **验收**：对话串中回复确实挂在被回复帖下，父子关系正确，无错位。
- **交接提示**：现 `CascadeSystem` 用扁平 `REPLY_POOL` 做级联回复，本阶段回复内容改由 reply 形态的内容池接管；级联接楼取父帖 id 依赖 `createPost` 返回形态（`{ post: { id } }`），已修正，注意不要回退。

### 3.3 回复内容贴合 ⬜

- **目标**：回复内容按 reply intent 贴合被回复帖语境（关系阶段先简化为中性）。
- **改动**：`simulator/src/`（按被回复帖话题 / 场景偏置 reply 池选择）。
- **验收**：回复与被回复帖在话题 / 场景上相称，非答非所问。

### 3.4 楼中楼回复 ⬜

- **目标**：NPC 回复回复，对话串多层自然生长。
- **改动**：`simulator/src/systems/`（对楼中楼节点继续回复判定）。
- **验收**：对话串出现多层楼中楼且层级挂接正确。

### 3.5 引用 ⬜

- **目标**：NPC 以 `quote` 形态引用他帖。
- **改动**：`simulator/src/`（引用动作 + 调 quote 端点带 `quoteOfId`）。
- **验收**：时间线出现引用帖，形态为 quote，被引帖正确关联。

### 3.6 对话串视图 ⬜

- **目标**：编辑器轨迹 / 对话串视图可见回复挂对父帖。
- **改动**：`editor/src/renderer/`（对话串视图）。
- **验收**：视图中回复节点正确挂在父帖下，与网站对话串结构一致。

### 3.7 轨迹块标注回应关系 ⬜

- **目标**：时间轴块标注回应了哪条帖、用了哪个 reply intent。
- **改动**：`editor/src/renderer/`（块详情显示 `targetPostId` 与 reply intent）。
- **验收**：点开回复块，看到它回应的目标帖与所用 reply intent。

### 3.8 Step 3 端到端验收 ⬜

- **目标**：在全新世界上断言回复闭环。
- **验收**：现建世界跑通后，时间线既有顶层帖又有回复，对话串自然生长且回复挂对父帖，轨迹标注回应关系与 reply intent。

---

## 后续阶段（粗线条占位，跑通确定性四步后展开）

确定性四步稳定后，状态机层按下列顺序逐层叠加，每层验收标准为「世界明显更不机械，且变化点可被指认」；其后接 LLM 行为层与 GM 导演层，最后 Electron 整体打包。

- **M5-X.0 Tuning 层补全**：`TuningService` 补 `evalDerive` / `reload` / `onChange`；编辑器 Tuning 面板（命名空间分组、default 与 override 并显、逐项 override、SSE reload 推至模拟器）。
- **M5-X.1 Mood + Memory**：`MoodComponent` / `MemoryComponent` 与对应 System、内部 EventBus、片段标签扩（`preferredAlignment` 等）；可见效果为同一 NPC 不同时刻发帖语气会变。
- **M5-X.2 Relationship + Activity FSM**：`RelationshipComponent`、`ActivityComponent`（Offline / Lurking / Browsing / Composing / InThread 五态）、`AttentionComponent`、运行时态持久化与启动 gap mitigation、关系阶段化；可见效果为 NPC 会追串、关系积累影响互动。
- **M5-X.3 戏剧态 + 撕逼蔓延**：FSM 补 Beefing / Tilted / Hyped、撕逼蔓延（观众池 + sigmoid join + 2 跳上限）、Alignment 双轴与 Persona 派生、九宫格 + slider + jitter UI、话题厌倦；可见效果为撕逼能持续并蔓延、不同 alignment 的 NPC 可识别地不同。
- **M5-X.4 剧本协作**：剧本 casting 表达式、期望前置状态、期望连锁、未上演日志；可见效果为作者只指定形象与意图不锁演员。
- **身份生成器**：昵称 / ID / 头像确定性生成（世界级风格分布 → 每风格语法 → 词库），handle 与 displayName 解耦，头像先哈希 / identicon 兜底 + 策展头像池。
- **长帖段落体**：松散长帖把 ECS 模型抬到段落粒度（组件为段落块、语法为文章结构）；紧密长帖归 LLM 行为层。
- **LLM 行为层接入**：紧密长帖与核心 NPC 现场生成、Agent 工具范式与 agentic 循环、盲评、提示词缓存纪律、预算降级；Agent 执行记录写 0.3b 已建好的 `sim-trace.db` `gm_agent_log` 表。
- **GM 导演层（M5-5）**：GM 唤醒控制器（真人活动 / 预设事件 / 内容池水位低 / 兜底间隔四触发）、任务分发、决策日志、预算降级、内容池补水。日志落点（0.3b 已建于 `sim-trace.db`）与话题结构性拆分（1.1b 已完成）均已前移到位，本层只负责产出数据：写决策日志、铺设完整话题热度生命周期编排。
- **MCP 接入**：tools / resources / prompts 映射、GM/Agent 职责打包为 MCP 提示词、程序拉 headless 宿主自动化。
- **Electron 整体打包（M5-6）**：把社交站 server、simulator、编辑器封装为 Electron 桌面应用，主进程管三子进程生命周期。
