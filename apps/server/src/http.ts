import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'
import type { ContentfulStatusCode, StatusCode } from 'hono/utils/http-status'
import { config } from './config.ts'

export class HttpError extends Error {
  status: number
  code: string
  constructor(status: number, message: string, code = 'error') {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

function applyHeaders(c: Context, headers: Record<string, string>): void {
  for (const [key, value] of Object.entries(headers)) c.header(key, value)
}

export function sendJson(
  c: Context,
  status: ContentfulStatusCode,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  c.header('Cache-Control', 'no-store')
  applyHeaders(c, headers)
  return c.json(body, status)
}

export function sendEmpty(
  c: Context,
  status: StatusCode,
  headers: Record<string, string> = {},
): Response {
  c.header('Cache-Control', 'no-store')
  applyHeaders(c, headers)
  return c.body(null, status)
}

export function redirect(
  c: Context,
  location: string,
  headers: Record<string, string> = {},
): Response {
  c.header('Cache-Control', 'no-store')
  applyHeaders(c, headers)
  return c.redirect(location, 302)
}

export async function readJson(c: Context, limit = config.maxBodyBytes): Promise<unknown> {
  const type = c.req.header('content-type') ?? ''
  if (!/^application\/json\b/i.test(type)) {
    throw new HttpError(415, '请求体必须是 application/json', 'unsupported_media_type')
  }
  const declared = c.req.header('content-length')
  if (declared && Number(declared) > limit) {
    throw new HttpError(413, '请求体超过大小限制', 'payload_too_large')
  }
  const body = c.req.raw.body
  if (!body) throw new HttpError(400, '请求体为空', 'empty_body')
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      size += value.byteLength
      if (size > limit) throw new HttpError(413, '请求体超过大小限制', 'payload_too_large')
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  if (size === 0) throw new HttpError(400, '请求体为空', 'empty_body')
  const merged = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(merged))
  } catch {
    throw new HttpError(400, 'JSON 解析失败', 'invalid_json')
  }
}

export function parseCookies(c: Context): Record<string, string> {
  const header = c.req.header('cookie')
  if (!header) return {}
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (!key) continue
    try {
      out[key] = decodeURIComponent(value)
    } catch {
      out[key] = value
    }
  }
  return out
}

interface CookieOptions {
  maxAgeMs?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Lax' | 'Strict' | 'None'
  path?: string
}

export function serializeCookie(name: string, value: string, opts: CookieOptions = {}): string {
  const segments = [`${name}=${encodeURIComponent(value)}`]
  segments.push(`Path=${opts.path ?? '/'}`)
  if (opts.maxAgeMs !== undefined)
    segments.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAgeMs / 1000))}`)
  if (opts.httpOnly !== false) segments.push('HttpOnly')
  if (opts.secure ?? config.secureCookies) segments.push('Secure')
  segments.push(`SameSite=${opts.sameSite ?? 'Lax'}`)
  return segments.join('; ')
}

export function clientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown'
  }
}
