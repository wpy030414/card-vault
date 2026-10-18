# CardVault

> 私人卡牌收藏 · QQ 扫码登录 · 暖粉拟物界面

CardVault 是一个只属于自己的卡牌收藏匣：用 QQ 扫码开门，把拍下来的卡面自动拉正、收进 SQLite，然后在屏幕平面上像手牌一样铺开、拨动、端详。

## 能做什么

- **QQ 扫码登录**：登录页只有一张纸质二维码卡片，直连腾讯网页 QQ 登录，无需申请 QQ 应用凭据；未登录无法访问任何藏品接口。
- **自动找卡面**：上传照片后自动寻找画面中最大的近似圆角矩形，透视、倾斜都会被拉正；四角可以手动微调，也可以直接使用整张照片。
- **自定义裁切模式**：同一拍摄位置的照片只需框一次四角并命名保存；之后在裁切页「整图」右侧点一下，就把同样的相对落点套到新照片上。模式在主页菜单里管理。
- **一卡一面或两面**：正面必填，背面可选；端详时轻点卡面即可翻面。
- **屏面手牌环**：所有卡片排列在屏幕平面上的同一段圆弧里，像一只手捏着扑克牌；快速拨动让牌环转起来，轻点停驻，上滑把某张牌拉到眼前。底部只显示「当前/总数」进度。
- **端详与编辑**：轻点卡面翻面；左上角菜单可以编辑标题与日期，或删除卡片。
- **主页菜单**：右上角菜单提供「自定义裁切模式」与「退出登录」，退出前仍需二次确认。
- **常驻彩光**：卡面始终覆着一层很淡的镭射彩光；手机转动时，光斑随陀螺仪在卡面上游走。摇一摇会让卡片轻轻变形、彩光变亮。
- **单文件持久化**：所有用户、会话、卡片与图片都落在 `DATA_DIR/vault.db` 一个 SQLite 文件里。

## 技术栈

| 层 | 选择 |
| --- | --- |
| 前端 | Vite 8（Rolldown）+ React 19 + TypeScript |
| 样式 | 原生 CSS，暖粉拟物主题，3D 翻面与 CSS 变量驱动的彩光 |
| 后端 | Node 原生 `node:http` 路由，开发时 Node 26 直接运行 TypeScript，生产用 tsup 打包 |
| 数据 | `@homurajs/db` + Drizzle ORM + `node:sqlite` |
| 登录 | 腾讯网页 QQ 扫码（ptlogin2），服务端持有 `qrsig` 轮询 |
| 测试 | Playwright E2E（真实构建 + 真实 SQLite） |

## 快速开始

要求 Node ≥ 22.18（原生剥离 TypeScript，且需要 `node:sqlite`），推荐 Node 26；包管理器使用 pnpm。

```bash
pnpm install
cp .env.example .env
pnpm dev
```

- 前端：<http://localhost:5173>
- API：<http://localhost:52188>
- 局域网：Vite 与 API 默认监听 `0.0.0.0`，同一 Wi-Fi 下的手机可以直接打开终端里打印的 Network 地址。

`.env` 里 `DEV_AUTH=1` 会显示「开发模式直接进入」按钮，仅用于本地调试，生产环境务必留空。

### 生产运行

```bash
pnpm build
pnpm start
```

构建后由同一个 Node 进程提供静态资源、`/api` 与 `/media`。

### 常用脚本

```bash
pnpm dev            # API + Vite 同时启动
pnpm typecheck      # 三个 workspace 包 + E2E 的类型检查
pnpm build          # tsup 打包服务端 + Vite 构建前端
pnpm start          # 生产服务器
pnpm test:e2e       # Playwright E2E（自动构建并在 4318 端口起服务）
pnpm db:generate    # 由 apps/server/src/schema.ts 生成 SQLite 迁移
```

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PUBLIC_URL` | `http://localhost:52188` | 对外站点地址，用于安全 Cookie 与 QQ 回调 |
| `PORT` | `52188` | API 端口 |
| `HOST` | `0.0.0.0` | API 监听地址 |
| `WEB_PORT` | `5173` | Vite 开发端口 |
| `WEB_HOST` | `0.0.0.0` | Vite 监听地址 |
| `VITE_API_TARGET` | 跟随 `PORT` | 开发代理目标 |
| `DEV_AUTH` | 空 | `1` 时开启本地开发登录 |
| `SESSION_DAYS` | `0` | 登录会话有效期（天），`0` 表示永久 |
| `DATA_DIR` | `./data` | SQLite 与数据文件目录 |
| `QQ_APP_ID` / `QQ_APP_KEY` | 空 | 可选的官方 QQ 互联跳转登录 |

## 目录

```
apps/server/src/           Node HTTP 服务、认证、卡片、SQLite
apps/server/drizzle/       由 schema 生成的 SQLite 迁移
apps/web/src/components/   登录、收藏匣、手牌环、端详、裁切、上传
apps/web/src/lib/          卡面检测、透视裁切、格式化
apps/web/src/hooks/        晃动与陀螺仪
packages/shared/src/       前后端共享的 API 类型与常量
e2e/                       Playwright 用例与测试辅助
docs/                      PRD、架构、决策与模块规格（specs/）
```

## 文档

- [产品需求](docs/PRD.md)
- [架构说明](docs/ARCHITECTURE.md)
- [设计决策](docs/DECISIONS.md)
- [登录模块](docs/specs/module-auth.md)
- [卡片模块](docs/specs/module-cards.md)
- [手牌环与端详](docs/specs/module-ring.md)
- [卡面检测与裁切](docs/specs/module-crop.md)
- [自定义裁切模式](docs/specs/module-crop-presets.md)

## 数据与隐私

- 图片以 BLOB 存在 `cards` 表，通过带登录校验的 `/media/:cardId/:side` 输出。
- 会话 token 只把 SHA-256 哈希写进数据库，Cookie 为 HttpOnly + SameSite=Lax；默认永久有效并在每次打开页面时续期，退出登录会立即删除服务端会话。
- QQ 身份由腾讯登录服务确认；服务端不保存 QQ 密码，也不依赖第三方 OAuth 应用。
- 删除卡片会同时删除正反面图片与会话外的所有关联数据。

## 已知边界

- 腾讯网页扫码属于公开网页登录通道，接口可能随腾讯调整而变化；若不可用，可改用可选的官方 QQ 互联参数。
- 彩光在 iOS 上会在首次触碰卡面时申请 DeviceOrientation 权限；Android 通常直接可用。
- 相机直出的 HEIC 若浏览器无法解码，需要先在相册中导出为 JPEG。
