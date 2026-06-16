# M5-X 文档索引

第二阶段模拟器在 `feat-M5-X-RE` 分支重启（先确定性后 LLM、编辑器为唯一观察窗、四步阶梯）。新会话按下列顺序读，可快速确认开发到哪、设计定了什么。标注 【设计】=目标设计待实现，【已实现】=代码已落地，【约束】=必须遵守，【示意】=可视参考。

## 阅读顺序

### 1. 起步必读
- `CLAUDE.md` — 项目交接：结构速览、关键机制、环境注意（Windows/PS）、下一步。
- `docs/m5-x-re-plan.md` — 本轮纲领【设计+进度】：先确定性后 LLM、四步阶梯（Step 0 地基 → 1 顶层帖 → 2 配图 → 3 回复）、三条数据线、编辑器双层、内容池 ECS 模型 + 篇幅维度 + NPC 私有池。
- `docs/m5-x-roadmap.md` — 施工路线图【设计+进度】：把四步阶梯展开为单提交级原子步，每步含目标 / 改动 / 验收 / 交接提示，模拟器与编辑器面板逐步同步长出；后续状态机层与 GM 层粗线条占位。接手具体某步先读此文件。
- `docs/m5-real-usage-contract.md` — 模拟器真实使用契约【约束】：跟随活动世界、账号模型、形态忠实、媒体、金标准端到端验收（须在全新世界跑通）。

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
- 【待实现】细步见 `docs/m5-x-roadmap.md`：Phase 0 已完成 0.3 决策轨迹落盘（per-world sim-trace.db）、0.3b GM/Agent 日志归位（gm_agent_log 表 + 拆 server agentLogs）、0.4 编辑器 Electron 骨架（electron-vite，main 拉起 Fastify 后端子进程 + renderer 取活动世界），0.5 多窗格壳（dockview 可拖拽分割 + 面板注册表），余下 0.6–0.8 控制台 → 0.9–0.11 时间轴与轨迹实时推送 → 0.12 验收；其后 Phase 1 内容池 ECS（含最小 TuningService）→ Phase 2 配图 → Phase 3 回复。状态机层、LLM 行为层、GM 导演层、Electron 整体打包按路线图末节顺延。
- 编辑器从 Phase 0 即 Electron 桌面形态（仅编辑器走 Electron，server/sim 仍 dev 进程），旧临时编辑器（单窗口标签页）整体废弃不保留。
- `demo` 世界（3 个 is_bot 账号 林辰/悠悠/丸子）为当前活动世界与演示基准，重建脚本 `scripts/demo-stp0.mjs`。旧世界（acgn-sim 等）已弃用。
