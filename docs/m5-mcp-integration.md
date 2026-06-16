# MCP 接入设计

## 定位

模拟器的 LLM 能力有两条接入路径：

- **API 路径（主路）**：程序经 LLMProvider 抽象直接调各厂 API（Claude / DeepSeek / Gemini），由程序编排 agentic 循环。自动后台 GM 以此为准。
- **MCP 路径（额外可选）**：把操作世界的工具、上下文、GM/Agent 职责经 MCP（Model Context Protocol）暴露给用户自己的 agent 宿主（Claude Code / Codex / Cursor / Claude 桌面端）。让只有订阅、没有 API key 的用户也能用其订阅额度驱动 LLM 功能。

MCP 路径不取代 API 路径。两条路径必须共用同一套工具实现与同一份 GM/Agent 提示词，不得各写一份。

## MCP 三件套映射

MCP 提供 tools / resources / prompts 三类原语，分别对应：

| MCP 原语 | 对应 | 例 |
|---|---|---|
| tools（工具） | 操作世界的动作 | 建号 / create_post / inject_topic / 预填 / set_relationship / browse_timeline / search_media |
| resources（资源） | 只读上下文 | 世界摘要 / lore 索引卡 / NPC 名册 / 近期 GM 决策日志 |
| prompts（提示词） | 打包的 GM / Agent 职责 | `socialsim:gm` / `socialsim:make-hot-thread` / `socialsim:npc-post` |

工具是 agent 操作世界的唯一接口；喂给 agent 的工具返回内容必须遵守盲评——剥除 `is_bot` 及一切可区分真人与 NPC 的标记。

## GM / Agent 职责打包为 MCP 提示词

把 GM 的角色与任务（API 路径中作为系统提示发出的同一段）登记为 MCP 提示词，宿主（如 Claude Code）将其呈现为斜杠命令。用户在宿主中调用 `/socialsim:gm` 后，宿主即履行完整 GM 生命周期：

1. 经资源 / 工具读世界现状与近期 GM 决策日志；
2. 判断本轮该做什么（提升哪个话题、给哪些 NPC 派活、补哪个内容池）；
3. 经工具下发任务、注入话题；
4. 经工具写一条决策摘要回日志。

Agent 任务同理打包，如 `/socialsim:make-hot-thread 原神` 由宿主用工具履行。

两个性质必须保持：

- **提示词只写一遍**：GM / Agent 的角色与任务提示词写一份，API 路径当系统提示用、MCP 路径当 MCP 提示词用。
- **状态在世界文件夹**：GM 不常驻、记忆不靠宿主——每次靠工具读日志、靠工具写日志，状态全在世界文件夹（GM/Agent 决策日志为 `data/worlds/<id>/sim-trace.db` 中一张独立表，随世界文件夹走，不进社交站 `world.db`）。宿主关闭重开或换人接手，连续性不丢。

## 自动化：程序拉起 headless 宿主

斜杠命令需用户手动触发。为免去手动，由程序的 GM 唤醒控制器在触发条件满足时**后台静默拉起一次 headless 宿主**（如 `claude -p "履行一次 GM 职责"`，已配好本服务的 MCP 服务器），宿主自行用 MCP 工具完成本轮 GM 后退出，用户无需键入。

分工：

- 程序的 GM 唤醒控制器管"**何时**唤醒 GM"——四类触发（真人活动 / 预设事件到点 / 内容池水位低 / 兜底间隔）。
- 用户宿主管"**本轮做什么**"——用订阅额度推理 + 用 MCP 工具操作世界。

落地为一种 LLMProvider：「本地宿主子进程」provider，GM 调度器照常 `provider.run(任务)`，其实现为后台 spawn 一次 headless 宿主，与各 API provider 并列，调度逻辑复用。由此订阅用户也能有自动后台 GM。

约束：

- headless 宿主子进程必须按可失败的外部进程处理：设超时、记日志、失败不崩主流程。GM 不需把结果返回程序（结果经工具写入世界），近似点火即走。
- GM 唤醒频率必须克制（每真实 10–30 分钟级），避免猛刷订阅触发限额或违反合理使用。
- 前提：用户机器须装好并登录目标宿主（一次性设置）；桌面形态的程序方能拉起本地 CLI。
- headless 支持以 Claude Code（`claude -p`）为稳定基准；其他宿主无头模式支持程度不一。
- 宿主自带的定时任务只能覆盖"固定间隔"一种触发；条件触发（如内容池水位低、真人在场）须由程序唤醒控制器驱动。

## 可观测性

无论用户在自己宿主中手动操作，还是程序拉 headless 宿主自动履行，所有写世界的动作都经本服务的 HTTP API，故决策轨迹照常记录。用户在宿主中操作、在编辑器 Studio 的时间轴里实时看到世界变化，两窗口天然配合。

## 已知边界

- 完全无人值守的自动 GM 以 API 路径为准；MCP 自动化依赖用户本地宿主环境与订阅可用性。
- MCP 路径的 agent 行为由用户宿主的模型与版本决定，质量与可复现性不如受控的 API 调用。
- 盲评、账号模型、形态忠实等契约对 MCP 路径同等适用——工具与资源返回的内容必须与 API 路径一致地剥除虚拟身份标记。
