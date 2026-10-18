import { randomUUID } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import type { CropPoint, CropPreset, CropQuad } from '@cardvault/shared/types'
import { db } from './db.ts'
import { HttpError } from './http.ts'
import { cropPresets } from './schema.ts'

/** 单用户场景下足够用，同时避免误操作堆出上百条同名模式 */
const MAX_PRESETS = 60
const MAX_NAME_LENGTH = 24

function invalidQuad(message: string): HttpError {
  return new HttpError(400, message, 'invalid_quad')
}

/** 校验并收敛四角落点：必须是 0..1 内的有限数，且围成一块非退化凸四边形 */
function parseQuad(raw: unknown): CropQuad {
  if (!Array.isArray(raw) || raw.length !== 4) throw invalidQuad('裁切模式需要四个角点')
  const points: CropPoint[] = raw.map((rawPoint) => {
    if (!rawPoint || typeof rawPoint !== 'object') throw invalidQuad('角点格式不正确')
    const { x, y } = rawPoint as Record<string, unknown>
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw invalidQuad('角点必须是有限的数字坐标')
    }
    if (x < 0 || x > 1 || y < 0 || y > 1) throw invalidQuad('角点必须落在图片范围内')
    return { x: Math.round(x * 1e6) / 1e6, y: Math.round(y * 1e6) / 1e6 }
  })

  let area = 0
  let sign = 0
  for (let index = 0; index < points.length; index++) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    const after = points[(index + 2) % points.length]!
    area += current.x * next.y - next.x * current.y
    const cross = (next.x - current.x) * (after.y - next.y) - (next.y - current.y) * (after.x - next.x)
    if (Math.abs(cross) < 1e-9) continue
    const currentSign = cross > 0 ? 1 : -1
    if (sign === 0) sign = currentSign
    else if (sign !== currentSign) throw invalidQuad('四个角点必须按顺序围成凸四边形')
  }
  if (Math.abs(area) / 2 < 0.002) throw invalidQuad('四个角点围成的区域太小')

  return points as CropQuad
}

function metaOf(row: { id: string; name: string; quad: string; createdAt: number }): CropPreset {
  let quad: CropQuad
  try {
    quad = parseQuad(JSON.parse(row.quad))
  } catch {
    // 库里只会有本模块写入的数据；真出现脏数据时用内缩整图兜底，列表不至于崩掉
    quad = [
      { x: 0.05, y: 0.05 },
      { x: 0.95, y: 0.05 },
      { x: 0.95, y: 0.95 },
      { x: 0.05, y: 0.95 },
    ]
  }
  return { id: row.id, name: row.name, quad, createdAt: row.createdAt }
}

export async function listCropPresets(userId: string): Promise<CropPreset[]> {
  const rows = await db()
    .select({ id: cropPresets.id, name: cropPresets.name, quad: cropPresets.quad, createdAt: cropPresets.createdAt })
    .from(cropPresets)
    .where(eq(cropPresets.userId, userId))
    .orderBy(desc(cropPresets.createdAt), desc(cropPresets.id))
  return rows.map(metaOf)
}

export async function createCropPreset(userId: string, body: Record<string, unknown>): Promise<CropPreset> {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) throw new HttpError(400, '请填写模式名称', 'invalid_name')
  if (Array.from(name).length > MAX_NAME_LENGTH) {
    throw new HttpError(400, `模式名称最多 ${MAX_NAME_LENGTH} 个字符`, 'invalid_name')
  }
  const quad = parseQuad(body.quad)

  const existing = await db().select({ id: cropPresets.id }).from(cropPresets).where(eq(cropPresets.userId, userId))
  if (existing.length >= MAX_PRESETS) {
    throw new HttpError(400, `裁切模式最多保存 ${MAX_PRESETS} 个`, 'too_many_presets')
  }

  const row = {
    id: randomUUID(),
    userId,
    name,
    quad: JSON.stringify(quad),
    createdAt: Date.now(),
  }
  await db().insert(cropPresets).values(row)
  return metaOf(row)
}

export async function deleteCropPreset(userId: string, presetId: string): Promise<void> {
  const removed = await db()
    .delete(cropPresets)
    .where(and(eq(cropPresets.id, presetId), eq(cropPresets.userId, userId)))
    .returning({ id: cropPresets.id })
  if (removed.length === 0) throw new HttpError(404, '裁切模式不存在', 'not_found')
}
