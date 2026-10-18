# AGENTS.md

CardVault 是单用户、单页的私人卡牌收藏应用：QQ 扫码登录后上传卡片照片，自动拉正，收纳进一个 SQLite 文件，以屏幕平面手牌环的方式陈列与端详。

## 概述
- 本项目是什么：Vite + React 的单页前端，配一个 `node:http` 后端；所有用户、会话、卡片与图片都落在 `DATA_DIR/vault.db`。
- 交付形态：自托管的单进程服务，开发时前后端分离启动，生产时同一进程同时提供静态资源与 `/api`、`/media`。

## 边界与范围
- 范围内：QQ 扫码登录与会话、卡片正反面上传与客户端拉正、标题/日期编辑、手牌环浏览、端详翻面、陀螺仪彩光、卡片删除。
- 非目标（明确排除）：卡片识别、估值、交易、社区、排行榜、多用户共享、公开主页、云端同步、原生 App、SSR。
- 身份只有 QQ；不引入邮箱、密码、手机号等其他登录方式。

## Agent 操作指南
- 先读 `docs/PRD.md` 判断行为语义，再读 `docs/ARCHITECTURE.md` 与 `docs/DECISIONS.md` 理解既有取舍；动手前先看 `docs/specs/` 中是否有对应模块规格。
- 新增或修改功能时，同步更新对应的 `docs/specs/module-*.md` 与 `docs/DECISIONS.md`；文档放在 `docs/` 下，仓库内不放截图、示意图或二进制资源。
- 数据模型变更必须通过 `pnpm db:generate` 生成迁移，不要手改 `apps/server/drizzle/` 下的既有迁移。
- 提交前至少运行 `pnpm check`；涉及交互、接口或持久化的改动需跑 `pnpm test:e2e`。
- E2E 使用独立端口 4318 与 `.e2e-data` 数据目录；本地调试使用 `DATA_DIR` 指向的项目内 `data/`，两者都不要提交。
- `DEV_AUTH=1` 只允许出现在本地环境；生产部署保持为空。
- 新增依赖前先评估是否必要：后端使用 Hono + `@hono/node-server`，不要引入 Express、Fastify、Nest 等平行框架；前端运行时只保留 React 与数据库相关依赖，构建/检查统一交给 vp（Vite+），不要另引 tsup、prettier、eslint 等平行工具。

## 目录速查
- `apps/server/src/` — HTTP 入口、路由、QQ 扫码认证、卡片接口、SQLite 连接与 schema
- `apps/web/src/` — React 应用、组件、样式、API 客户端与卡面处理工具
- `apps/web/src/lib/` — 卡面检测、透视裁切、格式化等纯前端逻辑
- `apps/web/src/hooks/` — 陀螺仪与晃动等浏览器能力封装
- `packages/shared/src/` — 前后端共享的 API 类型与常量
- `apps/server/drizzle/sqlite/` — 由 schema 生成的 SQLite 迁移
- `e2e/` — Playwright 用例与测试辅助
- `docs/` — PRD、架构、决策与模块规格
- `apps/web/public/`、`apps/web/index.html`、`apps/web/vite.config.ts`、`playwright.config.ts` — 构建与测试配置

## 工作区
- 根目录是 pnpm workspace：`apps/server`、`apps/web`、`packages/shared` 各自声明依赖，跨包引用使用 `workspace:*`。
- 常用脚本统一在根目录执行：`pnpm dev`、`pnpm build`、`pnpm start`、`pnpm check`、`pnpm typecheck`、`pnpm test:e2e`、`pnpm db:generate`。
- 构建与检查走 vp：前端 `vp dev` / `vp build`，服务端 `vp pack`，`vp check` 统一格式、lint 与类型；根目录 `vite.config.ts` 承载 workspace 级规则。
- `apps/server/.prettierignore` 排除 drizzle 生成的快照，避免 `vp check --fix` 改写生成物。
