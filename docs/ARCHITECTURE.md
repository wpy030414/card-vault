# CardVault 架构

## 1. 总览

仓库采用 pnpm workspace，分为 `apps/server`、`apps/web` 与 `packages/shared` 三个包。

```
浏览器（React 19，vp build 产物）
  │  /api/*、/media/*
  ▼
Hono（@hono/node-server，开发时 Node 直接执行 TS，生产由 vp pack 打包）
  ├─ auth.ts      QQ 扫码 / 会话 / 开发登录
  ├─ cards.ts     卡片与图片 BLOB
  ├─ http.ts      JSON、Cookie、限流辅助
  └─ db.ts        @homurajs/db + node:sqlite + 迁移
        │
        ▼
   DATA_DIR/vault.db（WAL）
```

开发时 Vite 监听 `0.0.0.0:5173`，把 `/api`、`/media` 代理到 API；生产时同一个 Node 进程同时提供 `apps/server/dist/client` 静态资源与接口。

路由由 Hono 声明式注册，安全响应头、错误映射、限流、静态资源与 SPA 回退集中在 `index.ts` 与 `http.ts`；认证与业务逻辑仍保持独立模块。

构建与检查由 vp（Vite+）统一驱动：前端 `vp dev` / `vp build`，服务端 `vp pack`（tsdown，ESM，`dist/index.js`），`vp check` 一次完成格式化、lint 与类型检查。`@cardvault/shared` 以 TS 源码直引，并由 `deps.alwaysBundle` 的正则匹配把 `@cardvault/shared/*` 全部内联，生产 bundle 自包含；`pnpm-workspace.yaml` 的 catalog 把 `vite` 固定到 `@voidzero-dev/vite-plus-core`，保证 `@vitejs/plugin-react` 的 peer 解析一致。

## 2. 数据模型

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `users` | `id`、`qq_open_id` 唯一、`nickname`、`avatar_url` | QQ 号是唯一身份 |
| `sessions` | `id`（token 哈希）、`user_id`、`expires_at` | HttpOnly Cookie 只保存原始 token |
| `login_attempts` | `token`、`mode`、`status`、`qrsig`、`ptqrtoken`、`qq_uin` | 扫码会话，10 分钟过期 |
| `cards` | 标题、日期、`holo` 镀层标记、正面/背面 mime、尺寸、BLOB | 图片与元数据同表，删除级联 |
| `crop_presets` | `name`、`quad`（归一化四角 JSON）、`created_at` | 自定义裁切模式，按用户级联删除 |

会话默认永久（`SESSION_DAYS=0`，Cookie 400 天滚动续期）；登录尝试 10 分钟；图片最大 8MB，请求体最大 24MB。

## 3. 登录流程（腾讯网页扫码）

1. 浏览器 `POST /api/auth/qq/qr`。
2. 服务端请求 `ssl.ptlogin2.qq.com/ptqrshow`，从 `Set-Cookie` 取出 `qrsig`，计算 `ptqrtoken = hash33(qrsig)`，把 PNG 转成 data URL 返回；数据库保存扫码会话。
3. 浏览器轮询 `GET /api/auth/qq/qr/:token`。
4. 服务端带 `qrsig` 请求 `ptqrlogin`，解析 `ptuiCB`：
   - `65` 过期；
   - `66/67` 等待/已扫码；
   - `0` 成功，从跳转 URL 提取 `uin`。
5. 以 `qq:<uin>` upsert 用户，创建会话，返回 `Set-Cookie: cv_session=...`（HttpOnly、SameSite=Lax、生产环境 Secure）。

官方 QQ 互联 OAuth 保留为可选后备，不影响扫码通道。

## 4. 手牌环几何

牌心位于以 `(50% , pivotY)` 为圆心、半径 `R` 的圆上；每张牌再绕自身中心旋转相同角度，因此牌面始终平行于屏幕：

```
cardAngle = (slot - center) * step
transform = rotate(cardAngle) translateY(-R) scale(s)
```

- `pivotY ≈ 97%` 视口高度，圆心落在屏幕下缘之外，弧线从下方把大牌托起来。
- `R` 由「顶边留白 + 卡高」反推；桌面约 520px，手机约 450px，让卡面尽可能大。
- `step` 由目标扇面跨度推导：桌面约 96°，窄屏约 30°；牌少时张得更开，范围 10°–26°。
- 可视槽位：窄屏 5、桌面 7（卡宽最大 300px）；其余卡片在循环队列中隐藏，转动时从两侧进出。
- 叠放按槽位从左到右，右侧牌压住左侧牌；不强制中心牌在最上层，被遮住时可以点击露出的部分。
- 槽位边界落在最外侧牌外半格：牌离开扇面时沿弧线继续滑出并在半张牌的距离内淡出，另一侧同理淡入。
- 惯性用指数摩擦，停驻用四次缓出吸附到 `step` 的整数倍。

## 5. 编辑与删除

- `PATCH /api/cards/:id` 只更新标题与日期；校验与创建一致。
- 端详左上角菜单提供编辑/删除；编辑用轻量弹窗，删除先确认，再播放缩小淡出动画。
- 主页顶栏的菜单按钮打开对话层，提供「自定义裁切模式」管理与「退出登录」；退出仍需二次确认。
- 牌山 → 端详使用共享元素过渡：记录源卡的中心、未旋转宽高与角度，端详卡从该位置旋转、平移、缩放到位。

## 6. 卡面检测与拉正

1. 画布缩放到最长边 2400px，铺白底。
2. 缩到 480px 做灰度 + Sobel，取高分位阈值、膨胀、8 连通域。
3. 每个候选求凸包与旋转卡尺最小外接矩形，按面积/周长覆盖/长宽比打分。
4. 输出四角；失败时回退为内缩 5% 的矩形。
5. 手动调整后，以单位正方形 → 四边形的单应矩阵反向采样，双线性插值、白底合成，输出最长边 1600px 的 JPEG。
6. 自定义裁切模式保存归一化四角；裁切页点击模式时直接替换当前四角，再走同一套拉正流程。模式本身不保存照片。

## 7. 端详与彩光

- `.examine-card-shell` 用 CSS 3D 做翻面；指针移动写入 `--rx/--ry`。
- `useMotionSensors`：
  - `devicemotion` 加速度差分检测摇一摇；
  - `deviceorientation` 的 `gamma/beta` 归一化为 `--hx/--hy/--hue`，低通平滑；
  - iOS 13+ 通过 `requestPermission()` 在用户手势中申请。
- 彩光层只在 `cards.holo = 1` 时渲染，随 `.examine-flip` 一起翻面；`is-holo` 仅在开启镀层后由摇一摇/点按触发临时增强。
- 桌面无触摸设备不做体感申请，改为鼠标位置驱动光斑。

## 8. 安全与边界

- API 不校验 Origin：会话 Cookie 为 `SameSite=Lax` + `HttpOnly`，跨站写请求不会携带凭据；登录取码接口另有按 IP 限流。这样同一服务经 localhost、局域网 IP 或域名访问都不会被误判。
- 登录接口按 IP 限流；Cookie 使用哈希后的会话 token。
- 静态资源路径规范化，禁止越出 `apps/server/dist/client`。
- 响应带 `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy` 等头。
- 图片读取校验 `userId`，避免横向越权。
