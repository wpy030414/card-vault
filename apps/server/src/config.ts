import { mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAX_IMAGE_BYTES, SESSION_COOKIE } from '@cardvault/shared/constants'

/** 服务端包目录：src/ 与打包后的 dist/ 都在 apps/server 下 */
export const PACKAGE_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
/** 仓库根目录：.env、默认 data/ 与迁移目录都相对它解析 */
export const ROOT = resolve(PACKAGE_ROOT, '..', '..')

/**
 * 轻量 .env 读取：只补齐未设置的变量。
 * 显式传入的环境变量优先，测试/部署时可覆盖 .env。
 */
function loadDotEnv(file: string): void {
  try {
    const text = readFileSync(file, 'utf8')
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq < 0) continue
      const key = line.slice(0, eq).trim()
      let value = line.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (process.env[key] === undefined) process.env[key] = value
    }
  } catch {
    // .env 不存在或不可读时使用默认值
  }
}

loadDotEnv(join(ROOT, '.env'))

const port = Number(process.env.PORT ?? 52188)
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`PORT 不是合法端口: ${process.env.PORT}`)
}

const publicUrl = (process.env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, '')
const dataDir = resolve(ROOT, process.env.DATA_DIR ?? './data')
const dbPath = process.env.DB_PATH ? resolve(ROOT, process.env.DB_PATH) : join(dataDir, 'vault.db')
const qqAppId = process.env.QQ_APP_ID?.trim() ?? ''
const qqAppKey = process.env.QQ_APP_KEY?.trim() ?? ''
const devAuth = process.env.DEV_AUTH === '1'
// 0 = 永久会话；单用户私人应用默认不掉线，需要固定期限时设置 SESSION_DAYS=30
const sessionDays = Number(process.env.SESSION_DAYS ?? 0)
if (!Number.isInteger(sessionDays) || sessionDays < 0) {
  throw new Error(`SESSION_DAYS 必须是非负整数（0 表示永久）: ${process.env.SESSION_DAYS}`)
}

mkdirSync(dataDir, { recursive: true })

export const config = {
  root: ROOT,
  host: process.env.HOST ?? '0.0.0.0',
  port,
  publicUrl,
  dataDir,
  dbPath,
  distDir: join(PACKAGE_ROOT, 'dist', 'client'),
  migrationsDir: join(PACKAGE_ROOT, 'drizzle', 'sqlite'),
  qqAppId,
  qqAppKey,
  qqEnabled: Boolean(qqAppId && qqAppKey),
  devAuth,
  secureCookies: publicUrl.startsWith('https://'),
  sessionCookie: SESSION_COOKIE,
  sessionTtlMs: sessionDays * 24 * 60 * 60 * 1000,
  loginAttemptTtlMs: 10 * 60 * 1000,
  maxImageBytes: MAX_IMAGE_BYTES,
  maxBodyBytes: 24 * 1024 * 1024,
  qqCallbackUrl: `${publicUrl}/api/auth/qq/callback`,
} as const

if (!config.qqEnabled) {
  console.warn(
    '[cardvault] QQ_APP_ID / QQ_APP_KEY 未配置：官方 QQ 互联跳转登录不可用（腾讯扫码登录不受影响）。' +
      (config.devAuth ? ' 已启用 DEV_AUTH 开发登录。' : ''),
  )
}
if (config.devAuth) {
  console.warn('[cardvault] DEV_AUTH=1：开发登录入口已开启，请勿在生产环境使用。')
}
