import { createHash, randomBytes } from 'node:crypto'
import type { Context } from 'hono'
import { and, eq, gt, lt } from 'drizzle-orm'
import { config } from './config.ts'
import { db } from './db.ts'
import { HttpError, parseCookies, serializeCookie } from './http.ts'
import { loginAttempts, sessions, users, type UserRow } from './schema.ts'

export interface AuthUser {
  id: string
  nickname: string
  avatarUrl: string | null
}

export interface SessionResult {
  token: string
  expiresAt: number
  user: AuthUser
}

const QQ_AUTHORIZE = 'https://graph.qq.com/oauth2.0/authorize'
const QQ_TOKEN = 'https://graph.qq.com/oauth2.0/token'
const QQ_ME = 'https://graph.qq.com/oauth2.0/me'
const QQ_USER_INFO = 'https://graph.qq.com/user/get_user_info'

/** 永久会话的 expires_at 哨兵：9999-12-31，保持 SQL 的 expires_at > now 判断继续成立 */
export const PERMANENT_SESSION_EXPIRY = Date.UTC(9999, 11, 31, 23, 59, 59, 999)

/** 浏览器对 Cookie 生命周期的实际上限（Chrome 会把超过 400 天的 Max-Age 静默截断） */
const SESSION_COOKIE_CAP_MS = 400 * 24 * 60 * 60 * 1000

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function publicUser(row: Pick<UserRow, 'id' | 'nickname' | 'avatarUrl'>): AuthUser {
  return { id: row.id, nickname: row.nickname, avatarUrl: row.avatarUrl }
}

export async function createSession(user: AuthUser): Promise<SessionResult> {
  const token = randomBytes(32).toString('base64url')
  const now = Date.now()
  const expiresAt = config.sessionTtlMs === 0 ? PERMANENT_SESSION_EXPIRY : now + config.sessionTtlMs
  await db()
    .insert(sessions)
    .values({ id: hashToken(token), userId: user.id, createdAt: now, expiresAt })
  return { token, expiresAt, user }
}

export function sessionCookie(token: string, expiresAt: number): string {
  // 永久会话也受浏览器 400 天上限约束，超出部分写入也会被截断
  const maxAgeMs = Math.min(SESSION_COOKIE_CAP_MS, Math.max(0, expiresAt - Date.now()))
  return serializeCookie(config.sessionCookie, token, {
    maxAgeMs,
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
  })
}

/**
 * 永久会话的 Cookie 每 400 天到期，靠页面加载时（GET /api/me）重新下发续期；
 * 只要在 400 天内打开过应用，登录状态就不会丢。
 */
export function renewedSessionCookie(c: Context): string | null {
  if (config.sessionTtlMs !== 0) return null
  const token = sessionToken(c)
  if (!token) return null
  return sessionCookie(token, PERMANENT_SESSION_EXPIRY)
}

export function logoutCookie(): string {
  return serializeCookie(config.sessionCookie, '', { maxAgeMs: 0, httpOnly: true })
}

function sessionToken(c: Context): string | null {
  return parseCookies(c)[config.sessionCookie] ?? null
}

export async function getSessionUser(c: Context): Promise<AuthUser | null> {
  const token = sessionToken(c)
  if (!token) return null
  const rows = await db()
    .select({
      id: users.id,
      nickname: users.nickname,
      avatarUrl: users.avatarUrl,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, Date.now())))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return publicUser(row)
}

export async function requireUser(c: Context): Promise<AuthUser> {
  const user = await getSessionUser(c)
  if (!user) throw new HttpError(401, '尚未登录', 'unauthorized')
  return user
}

export async function deleteSession(c: Context): Promise<void> {
  const token = sessionToken(c)
  if (!token) return
  await db()
    .delete(sessions)
    .where(eq(sessions.id, hashToken(token)))
}

/* ────────────────────────── 登录握手 ────────────────────────── */

export type AttemptMode = 'qqqr' | 'direct'

export interface LoginAttemptInfo {
  token: string
  mode: string
  status: string
  userId: string | null
  createdAt: number
  expiresAt: number
  expired: boolean
  qrsig: string | null
  ptqrtoken: string | null
  qqUin: string | null
}

export async function createLoginAttempt(mode: AttemptMode): Promise<LoginAttemptInfo> {
  const now = Date.now()
  // 顺手清掉一天前的过期握手，表不会无限增长
  await db()
    .delete(loginAttempts)
    .where(lt(loginAttempts.expiresAt, now - 24 * 60 * 60 * 1000))
  const token = randomBytes(24).toString('base64url')
  const expiresAt = now + config.loginAttemptTtlMs
  await db()
    .insert(loginAttempts)
    .values({ token, mode, status: 'pending', createdAt: now, expiresAt })
  return {
    token,
    mode,
    status: 'pending',
    userId: null,
    createdAt: now,
    expiresAt,
    expired: false,
    qrsig: null,
    ptqrtoken: null,
    qqUin: null,
  }
}

export async function getLoginAttempt(token: string): Promise<LoginAttemptInfo | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null
  const rows = await db()
    .select()
    .from(loginAttempts)
    .where(eq(loginAttempts.token, token))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return {
    token: row.token,
    mode: row.mode,
    status: row.status,
    userId: row.userId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    expired: row.expiresAt <= Date.now(),
    qrsig: row.qrsig,
    ptqrtoken: row.ptqrtoken,
    qqUin: row.qqUin,
  }
}

export async function markAttemptAuthorized(token: string, userId: string): Promise<boolean> {
  const attempt = await getLoginAttempt(token)
  if (!attempt || attempt.expired) return false
  await db()
    .update(loginAttempts)
    .set({ status: 'authorized', userId, claimedAt: null })
    .where(eq(loginAttempts.token, token))
  return true
}

/* ────────────────────── 腾讯 ptlogin2 扫码登录 ──────────────────────
 *
 * 不依赖 QQ 互联应用配置：直接使用腾讯自家的网页扫码登录通道，
 * 扫码确认后从回调 URL 的 uin 参数取到 QQ 号（唯一身份）。
 * qrsig 与 ptqrtoken 只在服务端保存，浏览器只拿到我们自己的握手 token。
 */

const PTLOGIN_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const PTLOGIN_REFERER = 'https://xui.ptlogin2.qq.com/'
const PTLOGIN_APPID = '549000912'
const PTLOGIN_DAID = '5'
const PTLOGIN_U1 = 'https://qzs.qq.com/qzone/v6/blog/common/blank.html'

/** 腾讯 ptlogin 的 hash33：ptqrtoken = hash33(qrsig) */
export function hash33(input: string): number {
  let hash = 0
  for (let index = 0; index < input.length; index++) {
    hash = (hash << 5) + hash + input.charCodeAt(index)
  }
  return hash & 0x7fffffff
}

function extractCookie(setCookies: string[], name: string): string | null {
  for (const cookie of setCookies) {
    const match = new RegExp(`(?:^|[;,]\\s*)${name}=([^;]+)`).exec(cookie)
    if (match) return match[1]!
  }
  return null
}

export interface QqQrSession {
  token: string
  image: string
  expiresAt: number
}

export async function createQqQrSession(): Promise<QqQrSession> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 100000)}`
  const url =
    `https://ssl.ptlogin2.qq.com/ptqrshow?appid=${PTLOGIN_APPID}&e=2&l=M&s=5&d=110&v=4&t=${stamp}` +
    `&daid=${PTLOGIN_DAID}&pt_3rd_aid=0`
  const response = await fetch(url, {
    headers: {
      'user-agent': PTLOGIN_UA,
      referer: PTLOGIN_REFERER,
      accept: 'image/png,image/*;q=0.8',
    },
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok)
    throw new HttpError(502, `QQ 登录服务返回 HTTP ${response.status}`, 'qq_upstream')
  const image = Buffer.from(await response.arrayBuffer())
  if (image.byteLength < 100) throw new HttpError(502, 'QQ 登录服务没有返回二维码', 'qq_upstream')
  const setCookies = response.headers.getSetCookie?.() ?? []
  const combined = response.headers.get('set-cookie')
  if (combined && setCookies.length === 0) setCookies.push(combined)
  const qrsig = extractCookie(setCookies, 'qrsig') ?? combined?.match(/qrsig=([^;]+)/)?.[1] ?? null
  if (!qrsig) throw new HttpError(502, 'QQ 登录服务没有下发扫码会话', 'qq_upstream')

  const now = Date.now()
  const token = randomBytes(24).toString('base64url')
  const expiresAt = now + 2 * 60 * 1000
  await db()
    .delete(loginAttempts)
    .where(lt(loginAttempts.expiresAt, now - 24 * 60 * 60 * 1000))
  await db()
    .insert(loginAttempts)
    .values({
      token,
      mode: 'qqqr',
      status: 'pending',
      qrsig,
      ptqrtoken: String(hash33(qrsig)),
      createdAt: now,
      expiresAt,
    })
  return { token, image: `data:image/png;base64,${image.toString('base64')}`, expiresAt }
}

export interface QqQrPollResult {
  status: 'pending' | 'scanned' | 'expired' | 'authorized'
  user?: AuthUser
  session?: SessionResult
}

export async function pollQqQr(token: string): Promise<QqQrPollResult> {
  const attempt = await getLoginAttempt(token)
  if (!attempt || attempt.mode !== 'qqqr') throw new HttpError(404, '二维码不存在', 'not_found')
  if (attempt.status === 'expired' || attempt.expired) return { status: 'expired' }

  // 已经授权过：直接重发一次会话（轮询重试时不会卡住）
  if (attempt.status === 'authorized' && attempt.userId) {
    const rows = await db().select().from(users).where(eq(users.id, attempt.userId)).limit(1)
    const row = rows[0]
    if (row) {
      const session = await createSession(publicUser(row))
      return { status: 'authorized', user: session.user, session }
    }
  }

  if (!attempt.qrsig || !attempt.ptqrtoken) return { status: 'expired' }

  const params = new URLSearchParams({
    u1: PTLOGIN_U1,
    ptqrtoken: attempt.ptqrtoken,
    ptredirect: '0',
    h: '1',
    t: '1',
    g: '1',
    from_ui: '1',
    ptlang: '2052',
    action: `0-0-${Date.now()}${Math.floor(Math.random() * 1000)}`,
    js_ver: '10233',
    js_type: '1',
    login_sig: '',
    pt_uistyle: '40',
    aid: PTLOGIN_APPID,
    daid: PTLOGIN_DAID,
    has_onekey: '1',
  })
  const response = await fetch(`https://ssl.ptlogin2.qq.com/ptqrlogin?${params.toString()}`, {
    headers: {
      'user-agent': PTLOGIN_UA,
      referer: PTLOGIN_REFERER,
      cookie: `qrsig=${attempt.qrsig}`,
      accept: 'text/plain,*/*',
    },
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok)
    throw new HttpError(502, `QQ 登录服务返回 HTTP ${response.status}`, 'qq_upstream')
  const text = await response.text()
  const match = /ptuiCB\('(\d+)','[^']*','([^']*)'/.exec(text)
  const code = match?.[1] ?? ''
  const redirectUrl = match?.[2] ?? ''

  if (code === '65') {
    await db()
      .update(loginAttempts)
      .set({ status: 'expired' })
      .where(eq(loginAttempts.token, token))
    return { status: 'expired' }
  }
  if (code === '67') {
    await db()
      .update(loginAttempts)
      .set({ status: 'scanned', seenAt: Date.now() })
      .where(eq(loginAttempts.token, token))
    return { status: 'scanned' }
  }
  if (code !== '0') {
    return { status: 'pending' }
  }

  const uin = /[?&]uin=(\d+)/.exec(redirectUrl)?.[1]
  if (!uin) throw new HttpError(502, 'QQ 登录成功但未能读取账号标识', 'qq_uin')
  const user = await upsertUser({
    openid: `qq:${uin}`,
    nickname: `QQ ${uin.slice(-4)}`,
    avatarUrl: `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=100`,
  })
  await db()
    .update(loginAttempts)
    .set({ status: 'authorized', userId: user.id, qqUin: uin, claimedAt: Date.now() })
    .where(eq(loginAttempts.token, token))
  const session = await createSession(user)
  return { status: 'authorized', user, session }
}

/* ────────────────────────── QQ OAuth ────────────────────────── */

interface QqTokenResponse {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  error?: number
  error_description?: string
}

interface QqMeResponse {
  client_id?: string
  openid?: string
  error?: number
  error_description?: string
}

interface QqUserInfo {
  ret?: number
  msg?: string
  nickname?: string
  figureurl_qq_1?: string
  figureurl_qq_2?: string
  figureurl_qq_3?: string
}

async function fetchQqJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'card-vault/0.1' },
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) throw new HttpError(502, `QQ 接口返回 HTTP ${res.status}`, 'qq_upstream')
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new HttpError(502, `QQ 接口返回了非 JSON 内容: ${text.slice(0, 120)}`, 'qq_upstream')
  }
}

export function qqAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.qqAppId,
    redirect_uri: config.qqCallbackUrl,
    state,
    scope: 'get_user_info',
  })
  return `${QQ_AUTHORIZE}?${params.toString()}`
}

export async function exchangeQqCode(
  code: string,
): Promise<{ openid: string; nickname: string; avatarUrl: string | null }> {
  const tokenParams = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.qqAppId,
    client_secret: config.qqAppKey,
    code,
    redirect_uri: config.qqCallbackUrl,
    fmt: 'json',
  })
  const token = await fetchQqJson<QqTokenResponse>(`${QQ_TOKEN}?${tokenParams.toString()}`)
  if (!token.access_token) {
    throw new HttpError(502, token.error_description || 'QQ access_token 获取失败', 'qq_token')
  }
  const me = await fetchQqJson<QqMeResponse>(
    `${QQ_ME}?${new URLSearchParams({ access_token: token.access_token, fmt: 'json' }).toString()}`,
  )
  if (!me.openid)
    throw new HttpError(502, me.error_description || 'QQ openid 获取失败', 'qq_openid')

  let nickname = `QQ 藏家 ${me.openid.slice(-4)}`
  let avatarUrl: string | null = null
  try {
    const info = await fetchQqJson<QqUserInfo>(
      `${QQ_USER_INFO}?${new URLSearchParams({
        access_token: token.access_token,
        oauth_consumer_key: config.qqAppId,
        openid: me.openid,
      }).toString()}`,
    )
    if (info.ret === 0 && info.nickname) nickname = info.nickname.slice(0, 40)
    avatarUrl = info.figureurl_qq_3 ?? info.figureurl_qq_2 ?? info.figureurl_qq_1 ?? null
  } catch {
    // 头像/昵称拉取失败不阻断登录
  }
  return { openid: me.openid, nickname, avatarUrl }
}

export async function upsertUser(input: {
  openid: string
  nickname: string
  avatarUrl: string | null
}): Promise<AuthUser> {
  const existing = await db().select().from(users).where(eq(users.qqOpenId, input.openid)).limit(1)
  if (existing[0]) {
    const row = existing[0]
    if (row.nickname !== input.nickname || row.avatarUrl !== input.avatarUrl) {
      await db()
        .update(users)
        .set({ nickname: input.nickname, avatarUrl: input.avatarUrl })
        .where(eq(users.id, row.id))
    }
    return publicUser({ ...row, nickname: input.nickname, avatarUrl: input.avatarUrl })
  }
  const inserted = await db()
    .insert(users)
    .values({
      qqOpenId: input.openid,
      nickname: input.nickname,
      avatarUrl: input.avatarUrl,
      createdAt: Date.now(),
    })
    .returning()
  return publicUser(inserted[0]!)
}

export async function devUser(): Promise<AuthUser> {
  const nickname = (process.env.DEV_USER_NAME ?? '人').slice(0, 40)
  return upsertUser({ openid: 'dev:local', nickname, avatarUrl: null })
}

export async function cleanupExpiredSessions(): Promise<void> {
  await db().delete(sessions).where(lt(sessions.expiresAt, Date.now()))
}

/** 切换到永久模式时，把仍然有效的旧会话一起延长，已登录的设备不用重新扫码 */
export async function promoteSessionsToPermanent(): Promise<void> {
  if (config.sessionTtlMs !== 0) return
  await db()
    .update(sessions)
    .set({ expiresAt: PERMANENT_SESSION_EXPIRY })
    .where(gt(sessions.expiresAt, Date.now()))
}
