# 登录模块规格

## 目标

用腾讯网页 QQ 扫码确认唯一身份；未登录用户只能看到登录页。身份不依赖 QQ 应用凭据。

## 界面

- 全屏暖粉背景 + 漂浮光点 + 中心一张纸质二维码卡。
- 卡片上只有标题「使用 QQ 登录 CardVault」、腾讯二维码、状态文案与必要操作。
- `DEV_AUTH=1` 时额外显示 `DEV 本地模式` 角标与「开发模式直接进入」按钮；生产环境不出现。
- 二维码过期或出错时显示「刷新二维码」。
- 不展示产品介绍长文、品牌大标题或功能清单。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/auth/config` | `qqEnabled`、`devAuth`、`publicUrl` |
| POST | `/api/auth/qq/qr` | 向腾讯取码，返回 token、PNG data URL、过期时间 |
| GET | `/api/auth/qq/qr/:token` | 轮询扫码状态；成功时下发会话 Cookie |
| POST | `/api/auth/dev/login` | 仅 DEV_AUTH 开启时可用 |
| POST | `/api/auth/logout` | 删除会话并清 Cookie |
| GET | `/api/me` | 当前用户；未登录 401 |

## 腾讯扫码状态机

```
loading → ready → scanned → authorized
                 ↘ expired → refresh → loading
                 ↘ error   → refresh → loading
```

`ptuiCB` 关键返回码：

| 码 | 含义 | 处理 |
| --- | --- | --- |
| 0 | 登录成功 | 从 URL 提取 `uin`，upsert 用户，创建会话 |
| 65 | 二维码过期 | 前端提示刷新 |
| 66 | 未扫码 | 继续轮询 |
| 67 | 已扫码待确认 | 提示在手机上确认 |

## 数据

- `users.qq_open_id = "qq:<uin>"`，唯一索引。
- 昵称默认 `QQ <uin 后四位>`；头像使用 `https://q1.qlogo.cn/g?b=qq&nk=<uin>&s=100`（无需登录即可取）。
- `login_attempts` 保存 `qrsig`、`ptqrtoken`、`qq_uin`，10 分钟过期；成功轮询后标记 `claimed_at`，防止重复兑换。
- 会话 token 随机生成，数据库只存 SHA-256；默认永久有效（`SESSION_DAYS=0`）。Cookie 受浏览器 400 天上限约束，每次页面加载通过 `GET /api/me` 重新下发，持续使用即不会掉线；设置 `SESSION_DAYS=30` 可恢复固定 30 天有效期。

## 安全

- Cookie：`HttpOnly`、`SameSite=Lax`、生产环境 `Secure`。
- 扫码取码接口按 IP 限流（30 次 / 5 分钟）。
- 不校验 Origin / Referer：CSRF 由 `SameSite=Lax` 的会话 Cookie（跨站 POST 不携带）与 JSON 写接口承担，服务经任意地址访问都能正常工作。
- 登录回调仅接受已创建且未过期的 state。

## 验收

- 未登录访问 `/api/me`、`/api/cards`、`/media/*` 返回 401。
- 开发登录后刷新仍保持会话；退出后 `/api/me` 立即 401。
- 腾讯接口不可用时前端显示错误与刷新按钮，不阻塞页面。
