# OpenAPI 规范

本项目的 HTTP API 以 **OpenAPI 3.1** 规范化，采用 **code-first**：spec 从 Fastify 路由 schema 自动生成，与代码同源、永不漂移。供协作开发查阅、客户端 codegen、Mock、契约测试。

## 三端覆盖

| 端 | 进程 | 在线文档 | 提交的 spec | 说明 |
|---|---|---|---|---|
| **社交站 server** | `:3000` | `GET /docs`（Swagger UI）、`GET /openapi.json` | `server.json` / `server.yaml` | 第二阶段唯一契约面：虚拟用户与真人走相同接口。128 操作全部含 tag / summary / operationId / security；核心数据端点含响应 schema。 |
| **编辑器后端** | `:5176` | `GET /docs`、`GET /openapi.json` | `editor.json` / `editor.yaml` | renderer 唯一数据源：多为社交站 admin API 的代理 + 布局存档 + 决策轨迹接入。无鉴权（仅 localhost）。 |
| **模拟器** | 无 HTTP 服务 | —— | —— | **无入站 HTTP API**，见下「模拟器：数据契约」。 |

## 怎么看

- **在线（推荐）**：起对应后端后浏览器开 `http://127.0.0.1:3000/docs`（社交站）或 `http://127.0.0.1:5176/docs`（编辑器后端）。可直接 try-it 调接口。
- **离线**：把提交在本目录的 `*.json` / `*.yaml` 拖进 [Swagger Editor](https://editor.swagger.io/) 或 Redoc，或喂给 openapi-generator 出客户端 SDK。

## 怎么重新生成（改了路由后）

```powershell
npm run gen:openapi -w @socialsim/server   # 刷新 server 响应组件 + server.{json,yaml}
npm run gen:openapi -w @socialsim/editor   # 刷新 editor.{json,yaml}
```

- `gen:openapi`（server）先跑 `gen:schemas` 从 `shared/src/types/` 的 TS 类型生成响应组件 schema（`server/src/core/openapi/components.generated.json`，**shared 类型为唯一真相源**），再不监听端口地构建 app、取 `app.swagger()` 落盘。
- 改了请求/响应形态后须重跑并提交快照，使仓库内 spec 与代码一致。

## 鉴权方案（server）

| securityScheme | 对应守卫 | 怎么带 |
|---|---|---|
| `bearerJWT` | requireAuth | `Authorization: Bearer <jwt>`（JWT 含 worldId，切世界后旧 token 全 401） |
| `adminKey` | requireAdmin | `Authorization: Bearer <adminKey>`（默认 `dev-admin-key`，env `SOCIALSIM_ADMIN_KEY`） |
| `sseToken` | SSE 流 | `?token=<jwt>`（EventSource 带不了 header） |

`/api/admin/worlds*` 当前**无 preHandler 鉴权**（服务端未强制），spec 如实不标 security。

## 设计说明

- **响应 schema 仅作文档、不作序列化**：Fastify 默认会用 `schema.response` 经 fast-json-stringify 序列化（并按 schema 过滤字段）。本项目用 `setSerializerCompiler` 让响应一律走 `JSON.stringify`，故：① 递归类型（`PostView.quoted → PostView`）不会让序列化器编译时栈溢出；② 响应负载与挂 response 之前**完全一致**，不会悄悄丢字段。请求体/参数校验仍走 Ajv，不受影响。
- **响应组件命名**：`components/schemas` 的名字即 shared 的 TS 类型名（经 `refResolver` 用 `$id` 命名）。
- **覆盖边界**：204 / SSE 端点无响应体；admin 的自由形态端点（lore / npc-profiles / topics / llm-config）、media-search / video / tools 等工具类端点暂未挂响应 schema——它们要么本就无 body，要么返回结构随业务演进、强行定 schema 反失真。请求侧（参数、鉴权、用途）均已文档化。

## 模拟器：数据契约（无 HTTP API）

模拟器是 API 的**消费方**，自身不开任何入站 HTTP 端点。它的契约由两部分构成：

1. **它调用的接口** = 社交站 `server.{json,yaml}`。模拟器只经这些公开/admin 端点写世界（与真人同通道），主要用到：`POST /api/admin/login-as`（取驱动票据）、`POST /api/posts`、互动/关注端点、`GET /api/media-search` → `POST /api/media/from-url`（配图链路）。
2. **它独占写的库**（观测态，绝不进 `world.db`，编辑器后端经 WAL 只读）：
   - `data/worlds/<id>/sim-trace.db` — 决策轨迹 `trace_event` 表（字段见 shared `SimTraceEvent` / `StoredSimTraceEvent`）+ GM/Agent 日志 `gm_agent_log` 表（`GmAgentLogEvent`）。这些类型也作为组件出现在两份 spec 的 `components/schemas` 中。
   - `data/worlds/<id>/npc-state.db` — NPC 数值与运行时态（状态机阶段落地）。

观测这些数据经**编辑器后端**（`editor.{json,yaml}` 的 `trace` 组）暴露：`GET /api/trace`、`GET /api/trace/stream`、`POST /api/trace/ingest`。
