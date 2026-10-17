# 卡片模块规格

## 目标

把正面/背面照片、标题、日期与所有权写进 SQLite，并能按用户读取、展示、删除。

## 数据表

`cards`：

- `id`：UUID
- `user_id`：外键，级联删除
- `title`、`card_date`（ISO 日期）
- `holo`：`0/1`，镀层标记，默认 `0`；决定端详时是否渲染彩光
- `front_mime/front_width/front_height/front_data`
- `back_mime/back_width/back_height/back_data`（可空）
- `created_at`

列表接口不返回 BLOB，只返回图片 URL 与尺寸。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/cards` | 当前用户的卡片，按创建时间倒序 |
| POST | `/api/cards` | 创建；校验标题、日期、`holo` 与两张图片 |
| PATCH | `/api/cards/:id` | 更新标题、日期与镀层；不传 `holo` 时保持原值，只能改自己的卡片 |
| DELETE | `/api/cards/:id` | 只能删除自己的卡片 |
| GET/HEAD | `/media/:cardId/:side` | `side` 为 `front` 或 `back`，需登录 |

## 图片校验

- data URL 必须为 `data:image/(jpeg|png|webp);base64,...`。
- 解码后最大 8MB。
- 校验魔数（JPEG `FF D8 FF`、PNG、WebP `RIFF....WEBP`）。
- 宽高必须为正且有限。
- 请求体最大 24MB，超过返回 413。

## 媒体响应

- `Content-Type` 使用入库时的 mime。
- `Cache-Control: private, max-age=31536000, immutable`。
- `ETag` 基于图片数据哈希；支持 `If-None-Match` 返回 304。
- 必须校验 `userId`，不能读取他人卡片。

## 编辑

- 标题 1–60 字符，日期 `YYYY-MM-DD`，校验规则与创建一致。
- 端详左上角菜单 → 编辑，弹窗可修改标题与日期；保存后列表项与端详标题同步更新。

## 删除

- 删除行即删除 BLOB；前端删除后同步从列表移除并关闭端详。
- 端详左上角菜单 → 删除，弹窗二次确认；卡片先缩小淡出，再调用删除接口。

## 验收

- 正反面入库后，端详可翻面看到背面。
- 刷新后藏品仍在。
- 两次点击删除后，列表与图片接口都不可再取到。
- 损坏的 data URL 不会创建卡片。
