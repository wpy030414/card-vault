import { sqliteTable, sqliteCol } from '@homurajs/db/schema-helpers'
import { blob, index } from 'drizzle-orm/sqlite-core'

/** 收藏者：以 QQ openid 为唯一身份 */
export const users = sqliteTable('users', {
  id: sqliteCol.id(),
  qqOpenId: sqliteCol.text('qq_open_id').notNull().unique(),
  nickname: sqliteCol.text('nickname').notNull(),
  avatarUrl: sqliteCol.text('avatar_url'),
  createdAt: sqliteCol.epochMs('created_at').notNull(),
})

/** 登录会话：库里只存 token 的 sha256，泄露库文件也无法冒用 */
export const sessions = sqliteTable(
  'sessions',
  {
    id: sqliteCol.text('id').primaryKey(),
    userId: sqliteCol.text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: sqliteCol.epochMs('created_at').notNull(),
    expiresAt: sqliteCol.epochMs('expires_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

/** 扫码登录的待确认握手；state 即 token */
export const loginAttempts = sqliteTable(
  'login_attempts',
  {
    token: sqliteCol.text('token').primaryKey(),
    mode: sqliteCol.text('mode').notNull(),
    status: sqliteCol.text('status').notNull(),
    userId: sqliteCol.text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    createdAt: sqliteCol.epochMs('created_at').notNull(),
    expiresAt: sqliteCol.epochMs('expires_at').notNull(),
    seenAt: sqliteCol.epochMs('seen_at'),
    claimedAt: sqliteCol.epochMs('claimed_at'),
    /** 腾讯 ptlogin2 扫码会话：qrsig cookie 与 ptqrtoken 只在服务端保存 */
    qrsig: sqliteCol.text('qrsig'),
    ptqrtoken: sqliteCol.text('ptqrtoken'),
    qqUin: sqliteCol.text('qq_uin'),
  },
  (t) => [index('login_attempts_expiry_idx').on(t.expiresAt)],
)

/** 卡片：图片以 BLOB 形式与元数据同库持久化，备份只需一个 .db 文件 */
export const cards = sqliteTable(
  'cards',
  {
    id: sqliteCol.id(),
    userId: sqliteCol.text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: sqliteCol.text('title').notNull(),
    cardDate: sqliteCol.text('card_date').notNull(),
    /** 镀层：开启后端详卡面才浮现镭射彩光 */
    holo: sqliteCol.int('holo').notNull().default(0),
    createdAt: sqliteCol.epochMs('created_at').notNull(),

    frontMime: sqliteCol.text('front_mime').notNull(),
    frontWidth: sqliteCol.int('front_width').notNull(),
    frontHeight: sqliteCol.int('front_height').notNull(),
    frontData: blob('front_data', { mode: 'buffer' }).notNull(),

    backMime: sqliteCol.text('back_mime'),
    backWidth: sqliteCol.int('back_width'),
    backHeight: sqliteCol.int('back_height'),
    backData: blob('back_data', { mode: 'buffer' }),
  },
  (t) => [index('cards_user_created_idx').on(t.userId, t.createdAt)],
)

export type UserRow = typeof users.$inferSelect
export type CardRow = typeof cards.$inferSelect
export type LoginAttemptRow = typeof loginAttempts.$inferSelect
