import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import type { Server } from 'node:http'
import { extname, normalize, resolve, sep } from 'node:path'
import { serve } from '@hono/node-server'
import { Hono, type Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import {
  cleanupExpiredSessions,
  createLoginAttempt,
  createQqQrSession,
  createSession,
  deleteSession,
  devUser,
  exchangeQqCode,
  getLoginAttempt,
  getSessionUser,
  logoutCookie,
  markAttemptAuthorized,
  pollQqQr,
  promoteSessionsToPermanent,
  qqAuthorizeUrl,
  renewedSessionCookie,
  requireUser,
  sessionCookie,
  upsertUser,
} from './auth.ts'
import { createCard, deleteCard, getCardImage, listCards, updateCard } from './cards.ts'
import { createCropPreset, deleteCropPreset, listCropPresets } from './cropPresets.ts'
import { config } from './config.ts'
import { closeDb, initDb } from './db.ts'
import { HttpError, clientIp, readJson, redirect, sendEmpty, sendJson } from './http.ts'

/* ────────────────────────── 静态资源 ────────────────────────── */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

const DEV_WEB_ORIGIN = (process.env.DEV_WEB_ORIGIN ?? 'http://localhost:5173').replace(/\/+$/, '')
const UUID_RE = /^[0-9a-f-]{36}$/

async function serveFile(c: Context, filePath: string, immutable: boolean): Promise<Response> {
  const info = await stat(filePath)
  const headers = {
    'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': String(info.size),
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Last-Modified': info.mtime.toUTCString(),
  }
  if (c.req.method === 'HEAD') return c.body(null, 200, headers)
  return c.body(new Uint8Array(await readFile(filePath)), 200, headers)
}

async function serveStatic(c: Context): Promise<Response> {
  const indexFile = resolve(config.distDir, 'index.html')
  if (!existsSync(indexFile)) {
    // `pnpm dev` 时前端由 Vite 提供；把 API 服务上的页面请求转过去（cookie 按 host 共享，登录态不丢）
    return redirect(c, `${DEV_WEB_ORIGIN}${c.req.path}${new URL(c.req.url).search}`)
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(c.req.path)
  } catch {
    throw new HttpError(400, '非法路径', 'bad_path')
  }
  const candidate = resolve(config.distDir, `.${normalize(decoded)}`)
  if (!candidate.startsWith(config.distDir + sep) && candidate !== config.distDir) {
    throw new HttpError(403, '禁止访问', 'forbidden')
  }
  if (existsSync(candidate) && (await stat(candidate)).isFile()) {
    return serveFile(c, candidate, decoded.startsWith('/assets/'))
  }
  const acceptsHtml = (c.req.header('accept') ?? '').includes('text/html') || decoded === '/'
  if (acceptsHtml) return serveFile(c, indexFile, false)
  return sendJson(c, 404, { error: 'Not Found' })
}

/* ────────────────────────── 登录限流 ────────────────────────── */

const rateBuckets = new Map<string, number[]>()
function rateLimit(c: Context, key: string, max: number, windowMs: number): void {
  const bucketKey = `${key}:${clientIp(c)}`
  const now = Date.now()
  const hits = (rateBuckets.get(bucketKey) ?? []).filter((t) => now - t < windowMs)
  if (hits.length >= max) throw new HttpError(429, '操作太频繁，请稍后再试', 'rate_limited')
  hits.push(now)
  rateBuckets.set(bucketKey, hits)
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) if (v.every((t) => now - t >= windowMs)) rateBuckets.delete(k)
  }
}

/* ────────────────────────── 应用 ────────────────────────── */

const app = new Hono()

// 安全响应头在 next 之后写入，错误响应也会带上
app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'same-origin')
  c.header('X-Frame-Options', 'DENY')
  c.header('Cross-Origin-Opener-Policy', 'same-origin')
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
})

app.onError((error, c) => {
  if (error instanceof HttpError) {
    return sendJson(c, error.status as ContentfulStatusCode, {
      error: error.message,
      code: error.code,
    })
  }
  console.error('[cardvault] 未处理错误', error)
  return sendJson(c, 500, { error: '服务器内部错误', code: 'internal_error' })
})

/* ────────────────────────── API 路由 ────────────────────────── */

app.get('/api/health', (c) =>
  sendJson(c, 200, { ok: true, qqEnabled: config.qqEnabled, devAuth: config.devAuth }),
)

app.get('/api/auth/config', (c) =>
  sendJson(c, 200, {
    qqEnabled: config.qqEnabled,
    devAuth: config.devAuth,
    publicUrl: config.publicUrl,
  }),
)

app.post('/api/auth/qq/qr', async (c) => {
  rateLimit(c, 'qqqr:new', 30, 5 * 60 * 1000)
  const qr = await createQqQrSession()
  return sendJson(c, 201, { token: qr.token, image: qr.image, expiresAt: qr.expiresAt })
})

app.get('/api/auth/qq/qr/:token', async (c) => {
  const result = await pollQqQr(c.req.param('token'))
  if (result.status === 'authorized' && result.session) {
    return sendJson(
      c,
      200,
      { status: result.status, user: result.user },
      { 'Set-Cookie': sessionCookie(result.session.token, result.session.expiresAt) },
    )
  }
  return sendJson(c, 200, { status: result.status })
})

app.post('/api/auth/dev/login', async (c) => {
  if (!config.devAuth) throw new HttpError(404, 'Not Found', 'not_found')
  const user = await devUser()
  const session = await createSession(user)
  return sendJson(
    c,
    200,
    { user },
    { 'Set-Cookie': sessionCookie(session.token, session.expiresAt) },
  )
})

app.post('/api/auth/direct', async (c) => {
  if (!config.qqEnabled) throw new HttpError(503, 'QQ 登录尚未配置', 'qq_unconfigured')
  const attempt = await createLoginAttempt('direct')
  return sendJson(c, 201, {
    url: `${config.publicUrl}/api/auth/qq/start?state=${attempt.token}`,
  })
})

app.get('/api/auth/qq/start', async (c) => {
  if (!config.qqEnabled) return redirect(c, '/?login=qq_unconfigured')
  const state = c.req.query('state') ?? ''
  const attempt = await getLoginAttempt(state)
  if (!attempt || attempt.expired) return redirect(c, '/?login=expired')
  return redirect(c, qqAuthorizeUrl(state))
})

app.get('/api/auth/qq/callback', async (c) => {
  const state = c.req.query('state') ?? ''
  const attempt = await getLoginAttempt(state)
  const fallback = attempt?.mode === 'direct' ? '/?login=failed' : `/qr/${state}?result=failed`
  if (!attempt || attempt.expired) return redirect(c, '/?login=expired')
  const qqError = c.req.query('error')
  if (qqError) {
    const target = attempt.mode === 'direct' ? '/?login=denied' : `/qr/${state}?result=denied`
    return redirect(c, target)
  }
  const code = c.req.query('code')
  if (!code) return redirect(c, fallback)
  try {
    const identity = await exchangeQqCode(code)
    const user = await upsertUser(identity)
    await markAttemptAuthorized(state, user.id)
    if (attempt.mode === 'direct') {
      const session = await createSession(user)
      return redirect(c, '/?login=ok', {
        'Set-Cookie': sessionCookie(session.token, session.expiresAt),
      })
    }
    return redirect(c, `/qr/${state}?result=ok`)
  } catch (error) {
    console.error('[cardvault] QQ 登录失败', error)
    return redirect(c, fallback)
  }
})

app.post('/api/auth/logout', async (c) => {
  await deleteSession(c)
  return sendEmpty(c, 204, { 'Set-Cookie': logoutCookie() })
})

app.get('/api/me', async (c) => {
  const user = await getSessionUser(c)
  if (!user) return sendJson(c, 401, { error: '尚未登录', code: 'unauthorized' })
  const renewed = renewedSessionCookie(c)
  return sendJson(c, 200, { user }, renewed ? { 'Set-Cookie': renewed } : {})
})

app.get('/api/cards', async (c) => {
  const user = await requireUser(c)
  return sendJson(c, 200, { cards: await listCards(user.id) })
})

app.post('/api/cards', async (c) => {
  const user = await requireUser(c)
  const body = await readJson(c)
  if (!body || typeof body !== 'object') throw new HttpError(400, '请求体格式错误', 'invalid_body')
  return sendJson(c, 201, { card: await createCard(user.id, body as Record<string, unknown>) })
})

app.patch('/api/cards/:id', async (c) => {
  const user = await requireUser(c)
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) throw new HttpError(404, '接口不存在', 'not_found')
  const body = await readJson(c)
  if (!body || typeof body !== 'object') throw new HttpError(400, '请求体格式错误', 'invalid_body')
  return sendJson(c, 200, {
    card: await updateCard(user.id, id, body as Record<string, unknown>),
  })
})

app.delete('/api/cards/:id', async (c) => {
  const user = await requireUser(c)
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) throw new HttpError(404, '接口不存在', 'not_found')
  await deleteCard(user.id, id)
  return sendEmpty(c, 204)
})

app.get('/api/crop-presets', async (c) => {
  const user = await requireUser(c)
  return sendJson(c, 200, { presets: await listCropPresets(user.id) })
})

app.post('/api/crop-presets', async (c) => {
  const user = await requireUser(c)
  const body = await readJson(c)
  if (!body || typeof body !== 'object') throw new HttpError(400, '请求体格式错误', 'invalid_body')
  return sendJson(c, 201, {
    preset: await createCropPreset(user.id, body as Record<string, unknown>),
  })
})

app.delete('/api/crop-presets/:id', async (c) => {
  const user = await requireUser(c)
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) throw new HttpError(404, '接口不存在', 'not_found')
  await deleteCropPreset(user.id, id)
  return sendEmpty(c, 204)
})

app.all('/api/*', (c) => sendJson(c, 404, { error: '接口不存在', code: 'not_found' }))

/* ────────────────────────── 图片 ────────────────────────── */

app.on(['GET', 'HEAD'], '/media/:id/:face', async (c) => {
  const id = c.req.param('id')
  const face = c.req.param('face')
  if (!UUID_RE.test(id) || (face !== 'front' && face !== 'back')) {
    throw new HttpError(404, '图片不存在', 'not_found')
  }
  const user = await requireUser(c)
  const image = await getCardImage(user.id, id, face)
  if (c.req.header('if-none-match') === image.etag) {
    return c.body(null, 304, { ETag: image.etag })
  }
  const headers = {
    'Content-Type': image.mime,
    'Content-Length': String(image.data.byteLength),
    'Cache-Control': 'private, max-age=31536000, immutable',
    ETag: image.etag,
  }
  if (c.req.method === 'HEAD') return c.body(null, 200, headers)
  return c.body(new Uint8Array(image.data), 200, headers)
})

app.all('/media/*', (c) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD') {
    return sendJson(c, 404, { error: '图片不存在', code: 'not_found' })
  }
  return sendJson(c, 405, { error: 'Method Not Allowed' })
})

/* ────────────────────────── 静态资源与 SPA ────────────────────────── */

app.on(['GET', 'HEAD'], '*', async (c) => {
  if (c.req.path.startsWith('/api/')) {
    return sendJson(c, 404, { error: '接口不存在', code: 'not_found' })
  }
  if (c.req.path.startsWith('/media/')) {
    return sendJson(c, 404, { error: '图片不存在', code: 'not_found' })
  }
  return serveStatic(c)
})

app.all('*', (c) => sendJson(c, 405, { error: 'Method Not Allowed' }))

/* ────────────────────────── 服务器 ────────────────────────── */

await initDb()
await promoteSessionsToPermanent()
const janitor = setInterval(
  () => {
    cleanupExpiredSessions().catch((error) => console.error('[cardvault] 清理会话失败', error))
  },
  60 * 60 * 1000,
)
janitor.unref()

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`[cardvault] API 已启动：http://localhost:${info.port}（监听 ${config.host}）`)
  console.log(`[cardvault] 数据文件：${config.dbPath}`)
  console.log(`[cardvault] QQ 回调：${config.qqCallbackUrl}`)
})

;(server as Server).on('clientError', (_error, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
})

function shutdown(): void {
  console.log('[cardvault] 正在关闭…')
  clearInterval(janitor)
  server.close(() => {
    closeDb()
    process.exit(0)
  })
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
