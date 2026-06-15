# NewSocialSim

本地社交媒体模拟器（仿 X）。第一阶段是一个真实可用的社交媒体网站；第二阶段将以它的 API 为接口构建多世界模拟引擎。详细设计见 [plan.md](plan.md)。

## 运行

需要 Node.js 22+。两个终端分别执行：

```powershell
npm install        # 首次
npm run dev:server # 后端 http://127.0.0.1:3000
npm run dev:client # 前端 http://localhost:5173
npm run dev:simulator 
npm run dev:editor # 编辑器  http://localhost:5174
```

打开 <http://localhost:5173>。演示账号：`alice` / `bob` / `carol`，密码均为 `secret123`（位于"现代地球"世界）。

## 结构

| 目录 | 说明 |
|---|---|
| `shared/` | 前后端共用的 TypeScript 类型（贫血实体） |
| `server/` | Fastify 后端。`core/` 为时钟/数据库/世界管理等基础设施，`modules/` 按功能域分层（routes → controller → service → repo） |
| `client/` | React + Vite + Tailwind 前端，feature 文件夹组织，i18n 中/英可切换 |
| `simulator/` | 模拟引擎（第二阶段，待建） |
| `data/worlds/<id>/` | 每个世界一个文件夹：`world.db`（全部数据）+ `world.json`（元数据与虚拟时钟状态），复制文件夹即可备份/开平行宇宙 |

## 验收脚本

```powershell
scripts/verify-m3.ps1   # 后端 API 端到端回归（需后端已启动）
```
