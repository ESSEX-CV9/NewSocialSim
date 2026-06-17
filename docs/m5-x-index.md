# M5-X 文档索引

第二阶段模拟器在 `feat-M5-X-RE` 分支重启（先确定性后 LLM、编辑器为唯一观察窗、四步阶梯）。新会话按下列顺序读，可快速确认开发到哪、设计定了什么。标注 【设计】=目标设计待实现，【已实现】=代码已落地，【约束】=必须遵守，【示意】=可视参考。

## 阅读顺序

### 1. 起步必读
- `CLAUDE.md` — 项目交接：结构速览、关键机制、环境注意（Windows/PS）、下一步。
- `docs/m5-x-re-plan.md` — 本轮纲领【设计+进度】：先确定性后 LLM、四步阶梯（Step 0 地基 → 1 顶层帖 → 2 配图 → 3 回复）、三条数据线、编辑器双层、内容池 ECS 模型 + 篇幅维度 + NPC 私有池。
- `docs/m5-x-roadmap.md` — 施工路线图【设计+进度】：把四步阶梯展开为单提交级原子步，每步含目标 / 改动 / 验收 / 交接提示，模拟器与编辑器面板逐步同步长出；后续状态机层与 GM 层粗线条占位。接手具体某步先读此文件。
- `docs/m5-real-usage-contract.md` — 模拟器真实使用契约【约束】：跟随活动世界、账号模型、形态忠实、媒体、金标准端到端验收（须在全新世界跑通）。
- `docs/m5-x-phase1-baseline.md` — Phase 1 基线【约束+现状】：配置范式（模拟器直读世界文件夹配置、social server 不经手）、当前 npc-profiles/内容池/话题的送达现状、各旧件在 1.x 各步的处置、`data/` 目录入 git 约定。

### 2. NPC 与内容设计
- `docs/m5-npc-state-machine.md` — 【设计】NPC 三层数据与存储（一 NPC 一文件夹 / 文件为准·DB 副本）、数值五层（Alignment/Persona/Mood/关系/Activity FSM）、RP 资料层、关系两面与阶段化、内容池 ECS（组件类型→语法→池）。
- `docs/m5-identity-generation.md` — 【设计】昵称/ID/头像确定性生成（世界级风格分布→语法→词库；handle 不可变故往往正经、displayName 可玩 meme、二者解耦）。

### 3. 接入与编辑器
- `docs/m5-design.md` — 【设计】M5 总设计：双层架构、Agent 工具范式、GM 生命周期、世界编辑器十面板。
- `docs/m5-mcp-integration.md` — 【设计】MCP 额外接入路（API 为主路）：tools/resources/prompts、GM 职责打包成 MCP 提示词、程序拉 headless 宿主自动化。
- `docs/editor-mockup.html` — 【示意】编辑器多窗格静态布局（浏览器打开，十面板 + 创作助手悬浮球）。

### 4. 总设计与路线
- `docs/design.md` — 全项目设计决策、架构约束、第一阶段成果、M5 路线与待办。

### 5. 进度
- `docs/devlog/2026-06-16.md` — 最新开发日志（M5-X-RE 重启、内容池 ECS 统一、Step 0a/0b、账号模型前端对齐）。
- `docs/devlog/2026-06-11..14*.md` — 第一阶段网站与 M5-1~4。

## 代码进度速查
- 分支 `feat-M5-X-RE`，基于 M5-4 完成态重启。
- 【已实现】Step 0a 代理建号（is_bot、拒绝 bot 命名）；Step 0b 模拟器跟随活动世界 + login-as 票据（不存密码）+ 时间基修正 + 发帖确定性化；账号模型前端对齐（删虚拟用户徽章、isBot 从公共 API 清除）。
- 【待实现】细步见 `docs/m5-x-roadmap.md`：Phase 0 已完成 0.3 决策轨迹落盘（per-world sim-trace.db）、0.3b GM/Agent 日志归位（gm_agent_log 表 + 拆 server agentLogs）、0.4 编辑器 Electron 骨架（electron-vite，main 拉起 Fastify 后端子进程 + renderer 取活动世界），0.5 多窗格壳（Blender 式工作区：dockview 自由停靠 + 每格 PaneHost 下拉切面板 + X 系配色/顶栏/状态条/创作助手悬浮球，去 rail）、0.6 控制台·读态（实时活动世界 + 时钟）、0.7 控制台·时钟控制（暂停/恢复/调速/跳转），0.5b 预设布局（观察/NPC建设/内容池/设定）+ 布局跟随世界存档（editor-layouts.json），0.8 模拟器状态（模拟器心跳上报 → 社交站按新鲜度判 running → 控制台「模拟器」卡显示绑定世界/账号数/tick/上次flush），0.9 编辑器后端轨迹接入（只读 sim-trace.db；WAL 坑：每次查询新开连接）、0.10 时间轴面板、0.11 轨迹实时推送。**时间轴设计校正**：按 m5-design.md，时间轴是查看世界全部帖子与互动的面板、**独立于模拟器**——块来自社交站全站流 `GET /api/timeline/global`（纯读 world.db，模拟器关也能用），含帖子/回复/引用/转发、无限向后滚动、检视器帖子预览；决策轨迹退为"为什么"增强层（非块来源，待 postId 合并）。早期"块=轨迹条"属偏离已校正。0.12 Step 0 金标准端到端验收脚本 `scripts/verify-step0.mjs`（断言式、依契约、现建世界跑完清理；2026-06-17 跑通 15/15）——**Phase 0 地基完成**。时间轴完善见路线图「时间轴完善」节：**T.1 互动事件流 / T.5 列全部账号 / T.2 时间区间跳转 / T.3 后端聚合端点已完成**（并由"看不到历史互动"牵出取数重构：互动/回复按区间取数、稳定横轴、后台预取整条轴、Alt+滚轮横滚——见日志 `2026-06-17-时间轴完善与取数重构.md`），**T.4 决策轨迹「为什么」postId 合并已完成**、**T.6 部分完成（仅「选中账号只看其轨道」，余轴上编辑/维度切换押后）**。三端 HTTP API 已 **OpenAPI 3.1 规范化**（`/docs` + `docs/openapi/`）。**Phase 1 顶层帖（内容池 ECS）已完成 1.0–1.4**（详见 `2026-06-18.md`）：1.0 TuningService 直读文件 / 1.1 三层 schema 与加载 / 1.2 组装引擎（混合式取片段 + 占位符 + 种子复现）/ 1.3 shape 过滤 / 1.4 PostingSystem 接组装（按 poolAffinities 选池→发 standalone→轨迹带池·语法·模块）。**配置范式定为模拟器直读文件**（social server 不经手；`data/global-config`、`data/global-pools` 入 git；见 `docs/m5-x-phase1-baseline.md`）。**1.1b 话题拆分经勘察重新定性为「不拆不迁移、押后」**（topics 表非用户可见）。**编辑器后端改由系统 node 拉起**（better-sqlite3 ABI 统一，曾因 Electron node ABI 不匹配致轨迹读空）。下一步 1.5 氛围号水贴 → 1.6/1.7/1.8 编辑器面板 → 1.9 端到端验收 → Phase 2 配图 / Phase 3 回复。状态机层、LLM 行为层、GM 导演层、Electron 整体打包按路线图末节顺延。
- 编辑器从 Phase 0 即 Electron 桌面形态（仅编辑器走 Electron，server/sim 仍 dev 进程），旧临时编辑器（单窗口标签页）整体废弃不保留。
- `demo` 世界（3 个 is_bot 账号 林辰/悠悠/丸子）为当前活动世界与演示基准，重建脚本 `scripts/demo-stp0.mjs`。旧世界（acgn-sim 等）已弃用。
