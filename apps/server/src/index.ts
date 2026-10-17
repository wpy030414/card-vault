import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, normalize, resolve, sep } from 'node:path'
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

function securityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'same-origin')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
}

function serveFile(req: IncomingMessage, res: ServerResponse, filePath: string, immutable: boolean): void {
  const stat = statSync(filePath)
  const ext = extname(filePath).toLowerCase()
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': String(stat.size),
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Last-Modified': stat.mtime.toUTCString(),
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(filePath).pipe(res)
}

function handleStatic(req: IncomingMessage, res: ServerResponse, pathname: string, search: string): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method Not Allowed' })
    return
  }
  const indexFile = resolve(config.distDir, 'index.html')
  if (!existsSync(indexFile)) {
    // `pnpm dev` 时前端由 Vite 提供；把 API 服务上的页面请求转过去（cookie 按 host 共享，登录态不丢）
    redirect(res, `${DEV_WEB_ORIGIN}${pathname}${search}`)
    return
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    throw new HttpError(400, '非法路径', 'bad_path')
  }
  const candidate = resolve(config.distDir, `.${normalize(decoded)}`)
  if (!candidate.startsWith(config.distDir + sep) && candidate !== config.distDir) {
    throw new HttpError(403, '禁止访问', 'forbidden')
  }
  if (existsSync(candidate) && statSync(candidate).isFile()) {
    serveFile(req, res, candidate, decoded.startsWith('/assets/'))
    return
  }
  const acceptsHtml = (req.headers.accept ?? '').includes('text/html') || decoded === '/'
  if (acceptsHtml) {
    serveFile(req, res, indexFile, false)
    return
  }
  sendJson(res, 404, { error: 'Not Found' })
}

/* ────────────────────────── 登录限流 ────────────────────────── */

const rateBuckets = new Map<string, number[]>()
function rateLimit(req: IncomingMessage, key: string, max: number, windowMs: number): void {
  const bucketKey = `${key}:${clientIp(req)}`
  const now = Date.now()
  const hits = (rateBuckets.get(bucketKey) ?? []).filter((t) => now - t < windowMs)
  if (hits.length >= max) throw new HttpError(429, '操作太频繁，请稍后再试', 'rate_limited')
  hits.push(now)
  rateBuckets.set(bucketKey, hits)
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) if (v.every((t) => now - t >= windowMs)) rateBuckets.delete(k)
  }
}

/* ────────────────────────── API 路由 ────────────────────────── */

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const path = url.pathname
  const method = req.method ?? 'GET'

  if (path === '/api/health' && method === 'GET') {
    sendJson(res, 200, { ok: true, qqEnabled: config.qqEnabled, devAuth: config.devAuth })
    return
  }

  if (path === '/api/auth/config' && method === 'GET') {
    sendJson(res, 200, {
      qqEnabled: config.qqEnabled,
      devAuth: config.devAuth,
      publicUrl: config.publicUrl,
    })
    return
  }

  if (path === '/api/auth/qq/qr' && method === 'POST') {
    rateLimit(req, 'qqqr:new', 30, 5 * 60 * 1000)
    const qr = await createQqQrSession()
    sendJson(res, 201, { token: qr.token, image: qr.image, expiresAt: qr.expiresAt })
    return
  }

  const qqQrMatch = /^\/api\/auth\/qq\/qr\/([A-Za-z0-9_-]{16,64})$/.exec(path)
  if (qqQrMatch && method === 'GET') {
    const result = await pollQqQr(qqQrMatch[1]!)
    if (result.status === 'authorized' && result.session) {
      sendJson(
        res,
        200,
        { status: result.status, user: result.user },
        { 'Set-Cookie': sessionCookie(result.session.token, result.session.expiresAt) },
      )
      return
    }
    sendJson(res, 200, { status: result.status })
    return
  }

  if (path === '/api/auth/dev/login' && method === 'POST') {
    if (!config.devAuth) throw new HttpError(404, 'Not Found', 'not_found')
    const user = await devUser()
    const session = await createSession(user)
    sendJson(res, 200, { user }, { 'Set-Cookie': sessionCookie(session.token, session.expiresAt) })
    return
  }

  if (path === '/api/auth/direct' && method === 'POST') {
    if (!config.qqEnabled) throw new HttpError(503, 'QQ 登录尚未配置', 'qq_unconfigured')
    const attempt = await createLoginAttempt('direct')
    sendJson(res, 201, { url: `${config.publicUrl}/api/auth/qq/start?state=${attempt.token}` })
    return
  }

  if (path === '/api/auth/qq/start' && method === 'GET') {
    if (!config.qqEnabled) {
      redirect(res, '/?login=qq_unconfigured')
      return
    }
    const state = url.searchParams.get('state') ?? ''
    const attempt = await getLoginAttempt(state)
    if (!attempt || attempt.expired) {
      redirect(res, '/?login=expired')
      return
    }
    redirect(res, qqAuthorizeUrl(state))
    return
  }

  if (path === '/api/auth/qq/callback' && method === 'GET') {
    const state = url.searchParams.get('state') ?? ''
    const attempt = await getLoginAttempt(state)
    const fallback = attempt?.mode === 'direct' ? '/?login=failed' : `/qr/${state}?result=failed`
    if (!attempt || attempt.expired) {
      redirect(res, '/?login=expired')
      return
    }
    const qqError = url.searchParams.get('error')
    if (qqError) {
      const target = attempt.mode === 'direct' ? `/?login=denied` : `/qr/${state}?result=denied`
      redirect(res, target)
      return
    }
    const code = url.searchParams.get('code')
    if (!code) {
      redirect(res, fallback)
      return
    }
    try {
      const identity = await exchangeQqCode(code)
      const user = await upsertUser(identity)
      await markAttemptAuthorized(state, user.id)
      if (attempt.mode === 'direct') {
        const session = await createSession(user)
        redirect(res, '/?login=ok', { 'Set-Cookie': sessionCookie(session.token, session.expiresAt) })
      } else {
        redirect(res, `/qr/${state}?result=ok`)
      }
    } catch (error) {
      console.error('[cardvault] QQ 登录失败', error)
      redirect(res, fallback)
    }
    return
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    await deleteSession(req)
    sendEmpty(res, 204, { 'Set-Cookie': logoutCookie() })
    return
  }

  if (path === '/api/me' && method === 'GET') {
    const user = await getSessionUser(req)
    if (!user) {
      sendJson(res, 401, { error: '尚未登录', code: 'unauthorized' })
      return
    }
    const renewed = renewedSessionCookie(req)
    sendJson(res, 200, { user }, renewed ? { 'Set-Cookie': renewed } : {})
    return
  }

  if (path === '/api/cards' && method === 'GET') {
    const user = await requireUser(req)
    sendJson(res, 200, { cards: await listCards(user.id) })
    return
  }

  if (path === '/api/cards' && method === 'POST') {
    const user = await requireUser(req)
    const body = await readJson(req)
    if (!body || typeof body !== 'object') throw new HttpError(400, '请求体格式错误', 'invalid_body')
    const card = await createCard(user.id, body as Record<string, unknown>)
    sendJson(res, 201, { card })
    return
  }

  const cardMatch = /^\/api\/cards\/([0-9a-f-]{36})$/.exec(path)
  if (cardMatch && method === 'PATCH') {
    const user = await requireUser(req)
    const body = await readJson(req)
    if (!body || typeof body !== 'object') throw new HttpError(400, '请求体格式错误', 'invalid_body')
    const card = await updateCard(user.id, cardMatch[1]!, body as Record<string, unknown>)
    sendJson(res, 200, { card })
    return
  }

  if (cardMatch && method === 'DELETE') {
    const user = await requireUser(req)
    await deleteCard(user.id, cardMatch[1]!)
    sendEmpty(res, 204)
    return
  }

  throw new HttpError(404, '接口不存在', 'not_found')
}

/* ────────────────────────── 图片 ────────────────────────── */

async function handleMedia(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method Not Allowed' })
    return
  }
  const match = /^\/media\/([0-9a-f-]{36})\/(front|back)$/.exec(url.pathname)
  if (!match) throw new HttpError(404, '图片不存在', 'not_found')
  const user = await requireUser(req)
  const image = await getCardImage(user.id, match[1]!, match[2]!)
  if (req.headers['if-none-match'] === image.etag) {
    res.writeHead(304, { ETag: image.etag })
    res.end()
    return
  }
  res.writeHead(200, {
    'Content-Type': image.mime,
    'Content-Length': String(image.data.byteLength),
    'Cache-Control': 'private, max-age=31536000, immutable',
    ETag: image.etag,
  })
  if (req.method === 'HEAD') res.end()
  else res.end(image.data)
}

/* ────────────────────────── 服务器 ────────────────────────── */

const server = createServer((req, res) => {
  securityHeaders(res)
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    try {
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url)
      } else if (url.pathname.startsWith('/media/')) {
        await handleMedia(req, res, url)
      } else {
        handleStatic(req, res, url.pathname, url.search)
      }
    } catch (error) {
      if (res.headersSent) {
        res.destroy()
        return
      }
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message, code: error.code })
      } else {
        console.error('[cardvault] 未处理错误', error)
        sendJson(res, 500, { error: '服务器内部错误', code: 'internal_error' })
      }
    }
  })()
})

server.on('clientError', (_error, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
})

await initDb()
await promoteSessionsToPermanent()
const janitor = setInterval(() => {
  cleanupExpiredSessions().catch((error) => console.error('[cardvault] 清理会话失败', error))
}, 60 * 60 * 1000)
janitor.unref()

server.listen(config.port, config.host, () => {
  console.log(`[cardvault] API 已启动：http://localhost:${config.port}（监听 ${config.host}）`)
  console.log(`[cardvault] 数据文件：${config.dbPath}`)
  console.log(`[cardvault] QQ 回调：${config.qqCallbackUrl}`)
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
