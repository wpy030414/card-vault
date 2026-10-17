import type { IncomingMessage, ServerResponse } from 'node:http'
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

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string | string[]> = {},
): void {
  const payload = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(payload.byteLength),
    'Cache-Control': 'no-store',
    ...headers,
  })
  res.end(payload)
}

export function sendEmpty(res: ServerResponse, status: number, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers })
  res.end()
}

export async function readJson(req: IncomingMessage, limit = config.maxBodyBytes): Promise<unknown> {
  const type = req.headers['content-type'] ?? ''
  if (!/^application\/json\b/i.test(type)) {
    throw new HttpError(415, '请求体必须是 application/json', 'unsupported_media_type')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    size += buf.byteLength
    if (size > limit) throw new HttpError(413, '请求体超过大小限制', 'payload_too_large')
    chunks.push(buf)
  }
  if (size === 0) throw new HttpError(400, '请求体为空', 'empty_body')
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'JSON 解析失败', 'invalid_json')
  }
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie
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
  if (opts.maxAgeMs !== undefined) segments.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAgeMs / 1000))}`)
  if (opts.httpOnly !== false) segments.push('HttpOnly')
  if (opts.secure ?? config.secureCookies) segments.push('Secure')
  segments.push(`SameSite=${opts.sameSite ?? 'Lax'}`)
  return segments.join('; ')
}

export function redirect(res: ServerResponse, location: string, headers: Record<string, string | string[]> = {}): void {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...headers })
  res.end()
}

export function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0]!.trim()
  return req.socket.remoteAddress ?? 'unknown'
}

