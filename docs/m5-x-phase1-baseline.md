# Phase 1 基线：配置送达与旧件处置

记录顶层帖（内容池 ECS）落地前的代码基线：模拟器域配置当前怎么送达、确定的配置范式、Phase 1 各步对现有旧件的处置，以及 `data/` 目录约定。

## 配置范式（本期确定）

**模拟器直接读世界文件夹的配置文件；社交站 server 不经手任何模拟器域配置。**

- **tuning**：全局默认 `data/global-config/defaults.json`（入 git）+ 世界级 override `data/worlds/<id>/tuning.json`，deep-merge，未覆盖项用默认。
- **内容池（ECS 三层）**：基础原子池 `data/global-pools/`（入 git）、场景特化池 `data/worlds/<id>/scene-pools/`、话题专属池 `data/worlds/<id>/topic-pools/`；组件类型库与语法库同样按「全局共享 / 世界级」两层存放，全局层入 git。
- **编辑器面板改这些配置时，经编辑器后端直接读写世界文件夹的文件**，不经社交站 server。

依据：

- `docs/m5-real-usage-contract.md` 规定一个世界的全部驱动配置（tuning override、三类内容池、npc-profiles、账号 roster）必须从该世界自己的文件夹加载，复制文件夹即得完整可驱动的世界。
- `docs/m5-x-re-plan.md` 三条数据线把「配置随世界文件夹」单列为一条独立线，与「改世界走 server 公开/admin API」「观测世界走编辑器后端」分离。读配置不属于「改世界」通道，故不经社交站 server。
- 模拟器进程已持有基础设施配置 `dataDir`，并已直接读写 `data/worlds/<id>/sim-trace.db`，直读世界文件夹的配置文件无新增障碍。

## 当前配置送达现状（基线，待本期改造）

| 配置 | 存放 | 现读写方 | 现送达模拟器的方式 |
|---|---|---|---|
| NPC 档案 | `data/worlds/<id>/npc-profiles.json` | server `npc.service` 代读写 | 模拟器 fetch `GET /api/admin/npc-profiles` |
| 内容池（旧·扁平 `string[]`） | `data/worlds/<id>/content-pools.json` | server `admin.service` 代读写 | 模拟器 fetch `GET /api/admin/content-pools` |
| 话题 | `world.db` 的 `topics` 表（含 stage / heat / tags / 生命周期字段） | server `admin.service` | 模拟器 fetch `GET /api/admin/topics?active=true` |

NPC 档案与旧内容池的文件本就在世界文件夹内，社交站 server 仅代读一道；改为模拟器直读即删去该转交。话题在 `world.db` 表内，须按分库原则拆分。

## Phase 1 旧件处置

| 旧件 | 处置 | 步 |
|---|---|---|
| 旧内容池（扁平 `string[]` + `GET/POST/DELETE /api/admin/content-pools`） | 整体替换为 ECS 池模型，改模拟器直读文件；旧文件与端点退役 | 1.1 / 1.6 |
| `simulator/src/simulator.ts` 的硬编码 `DEFAULT_FALLBACK_POOL` / `REPLY_POOL` | 删除，由内容池接管 | 1.4 / 1.5 |
| `simulator/src/systems/posting-system.ts` 的 `pickContent`（随机取一条） | 重写接组装引擎；`refreshPoolsIfNeeded` 改直读文件 | 1.4 |
| `posting-system.ts` 内散落的 `Math.random` 抖动 / 概率字面量 | 抽进 TuningService | 1.0 起 |
| 话题（`world.db` 表，含 heat / tags / 生命周期） | **不动**（经勘察重新定性，见下）；表保留备用 | 1.1b 押后 |
| NPC 档案 | 复用并扩字段（加 factions / poolAffinities），读改为直读文件 | 1.7 |
| lore / llm-config / 快照 / agent 等 admin 端点 | 不动（属后续 LLM / GM 阶段） | — |

Phase 1 顶层帖相关的全部旧件恰好落在以上各步的计划改动内，计划外无遗留依赖。

## 话题表定性（2026-06-18 勘察结论，勿回退）

`world.db` 的 `topics` 表**不给真人用户看**，整个属模拟器/导演侧——**不拆、不迁移**。依据：

- 用户侧"趋势 / 热门话题"（`GET /api/search/trends`）**完全由帖子正文的 `#话题` 标签统计而来**（`search.service.trends` 读 `posts` 表数 hashtag），**与 `topics` 表无关**。
- `topics` 表无任何公开端点，只有 admin（编辑器/配置）与模拟器（选题）读；真人从不创建或看到它。

因此早先"按字段拆 topics 表 + 加 migration"的设想（基于"话题对真人可见"的假设）取消。`world.db` 的 `topics` 表保留不动，留给将来"真给用户看的话题页"那个尚未实现的功能。话题的导演议程（hashtag + 选题标签 + 绑定话题池 + 热度）作为后续独立一步落在**模拟器侧文件**，模拟器直读、NPC 发帖带 hashtag 即经趋势对真人可见，**无需 migration**。若将来真做"用户可见话题页"，再按 `docs/m5-x-re-plan.md`「双重身份实体」把展示字段进 `world.db`、编排元数据留模拟器侧。

## `data/` 目录约定

- **入 git**：`data/global-config/`、`data/global-pools/`（本期新建，全局共享配置与基础原子池）。
- **不入 git**：`data/worlds/<id>/`（运行时世界数据与世界级配置）、`llm-config.json`、`media-search.json`、`jwt.secret`、`state.json`、`simulator-key.txt`、`bin/`。

`data/state.json` 记录当前活动世界 id，server 启动据此恢复，属运行态、不可删。

## 已清理的非代码旧渣

删除（开发期残留，不影响代码，`data/` 不入 git）：

- `sim-config-*.json`（旧模拟器启动配置，含 `worldId` / `accounts` / 明文密码字段，已被「跟随活动世界」取代）。
- `sim-*.log` / `sim-*.err`（运行日志）。
- `worlds.bak-v4` 至 `worlds.bak-v12`（旧 migration 版本的 DB 备份）。
- `tmp/`（视频暂存）。

保留：`state.json`、`simulator-key.txt`、`jwt.secret`、`llm-config.json`、`media-search.json`、`bin/`、`worlds/`。
