import { createSqliteDb, runMigrations, type SqliteDatabase } from '@homurajs/db'
import { config } from './config.ts'

let database: SqliteDatabase | null = null

/** 打开 SQLite、开启 WAL/外键并执行 drizzle 迁移（幂等） */
export async function initDb(): Promise<SqliteDatabase> {
  if (database) return database
  const db = createSqliteDb({ dialect: 'sqlite', path: config.dbPath })
  db.$client.exec('PRAGMA journal_mode = WAL;')
  db.$client.exec('PRAGMA foreign_keys = ON;')
  db.$client.exec('PRAGMA busy_timeout = 5000;')
  await runMigrations(db, config.migrationsDir)
  database = db
  return db
}

export function db(): SqliteDatabase {
  if (!database) throw new Error('数据库尚未初始化')
  return database
}

export function closeDb(): void {
  database?.$client.close()
  database = null
}
