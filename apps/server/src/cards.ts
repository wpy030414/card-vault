import { randomUUID } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { config } from './config.ts'
import { db } from './db.ts'
import { HttpError } from './http.ts'
import { cards } from './schema.ts'

export interface CardImageMeta {
  width: number
  height: number
  url: string
}

export interface CardMeta {
  id: string
  title: string
  cardDate: string
  createdAt: number
  /** 是否带镀层：只有开启的卡片才会显示镭射彩光 */
  holo: boolean
  front: CardImageMeta
  back: CardImageMeta | null
}

interface DecodedImage {
  mime: string
  data: Buffer
  width: number
  height: number
}

const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/
const MAX_SIDE = 12_000

function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
    return 'image/png'
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp'
  return null
}

export function decodeImage(raw: unknown, label: string): DecodedImage {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, `${label}缺失`, 'invalid_image')
  const obj = raw as Record<string, unknown>
  const dataUrl = typeof obj.dataUrl === 'string' ? obj.dataUrl : ''
  const match = DATA_URL_RE.exec(dataUrl)
  if (!match)
    throw new HttpError(400, `${label}必须是 JPEG/PNG/WebP 的 base64 data URL`, 'invalid_image')
  const data = Buffer.from(match[2]!, 'base64')
  if (data.byteLength === 0) throw new HttpError(400, `${label}内容为空`, 'invalid_image')
  if (data.byteLength > config.maxImageBytes) {
    throw new HttpError(
      413,
      `${label}超过 ${Math.round(config.maxImageBytes / 1024 / 1024)}MB`,
      'image_too_large',
    )
  }
  const sniffed = sniffMime(data)
  if (!sniffed) throw new HttpError(400, `${label}文件头不是受支持的图片格式`, 'invalid_image')
  const width = Number(obj.width)
  const height = Number(obj.height)
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_SIDE ||
    height > MAX_SIDE
  ) {
    throw new HttpError(400, `${label}尺寸不合法`, 'invalid_image')
  }
  return { mime: sniffed, data, width, height }
}

function metaOf(
  row: {
    id: string
    title: string
    cardDate: string
    createdAt: number
    holo: number
    frontWidth: number
    frontHeight: number
    backWidth: number | null
    backHeight: number | null
  },
  hasBack: boolean,
): CardMeta {
  return {
    id: row.id,
    title: row.title,
    cardDate: row.cardDate,
    createdAt: row.createdAt,
    holo: row.holo === 1,
    front: { width: row.frontWidth, height: row.frontHeight, url: `/media/${row.id}/front` },
    back:
      hasBack && row.backWidth && row.backHeight
        ? { width: row.backWidth, height: row.backHeight, url: `/media/${row.id}/back` }
        : null,
  }
}

export async function listCards(userId: string): Promise<CardMeta[]> {
  const rows = await db()
    .select({
      id: cards.id,
      title: cards.title,
      cardDate: cards.cardDate,
      createdAt: cards.createdAt,
      holo: cards.holo,
      frontWidth: cards.frontWidth,
      frontHeight: cards.frontHeight,
      backWidth: cards.backWidth,
      backHeight: cards.backHeight,
    })
    .from(cards)
    .where(eq(cards.userId, userId))
    .orderBy(desc(cards.createdAt), desc(cards.id))
  // 列表只读尺寸字段，BLOB 始终留在库里按需取用
  return rows.map((row) => metaOf(row, row.backWidth != null && row.backHeight != null))
}

export async function createCard(userId: string, body: Record<string, unknown>): Promise<CardMeta> {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) throw new HttpError(400, '请填写卡片标题', 'invalid_title')
  if (Array.from(title).length > 60) throw new HttpError(400, '标题最多 60 个字符', 'invalid_title')
  const cardDate = typeof body.cardDate === 'string' ? body.cardDate.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cardDate) || Number.isNaN(Date.parse(`${cardDate}T00:00:00Z`))) {
    throw new HttpError(400, '日期格式应为 YYYY-MM-DD', 'invalid_date')
  }

  const holo = body.holo === true
  const front = decodeImage(body.front, '正面图片')
  const backRaw = body.back
  const back = backRaw == null ? null : decodeImage(backRaw, '背面图片')
  const id = randomUUID()
  const now = Date.now()

  await db()
    .insert(cards)
    .values({
      id,
      userId,
      title,
      cardDate,
      holo: holo ? 1 : 0,
      createdAt: now,
      frontMime: front.mime,
      frontWidth: front.width,
      frontHeight: front.height,
      frontData: front.data,
      backMime: back?.mime ?? null,
      backWidth: back?.width ?? null,
      backHeight: back?.height ?? null,
      backData: back?.data ?? null,
    })

  return {
    id,
    title,
    cardDate,
    createdAt: now,
    holo,
    front: { width: front.width, height: front.height, url: `/media/${id}/front` },
    back: back ? { width: back.width, height: back.height, url: `/media/${id}/back` } : null,
  }
}

export async function updateCard(
  userId: string,
  cardId: string,
  body: Record<string, unknown>,
): Promise<CardMeta> {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) throw new HttpError(400, '请填写卡片标题', 'invalid_title')
  if (Array.from(title).length > 60) throw new HttpError(400, '标题最多 60 个字符', 'invalid_title')
  const cardDate = typeof body.cardDate === 'string' ? body.cardDate.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cardDate) || Number.isNaN(Date.parse(`${cardDate}T00:00:00Z`))) {
    throw new HttpError(400, '日期格式应为 YYYY-MM-DD', 'invalid_date')
  }
  const holo = typeof body.holo === 'boolean' ? (body.holo ? 1 : 0) : undefined
  const rows = await db()
    .update(cards)
    .set({ title, cardDate, ...(holo === undefined ? {} : { holo }) })
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId)))
    .returning({
      id: cards.id,
      title: cards.title,
      cardDate: cards.cardDate,
      createdAt: cards.createdAt,
      holo: cards.holo,
      frontWidth: cards.frontWidth,
      frontHeight: cards.frontHeight,
      backWidth: cards.backWidth,
      backHeight: cards.backHeight,
    })
  const row = rows[0]
  if (!row) throw new HttpError(404, '卡片不存在', 'not_found')
  return metaOf(row, row.backWidth != null && row.backHeight != null)
}

export async function deleteCard(userId: string, cardId: string): Promise<void> {
  const result = await db()
    .delete(cards)
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId)))
    .returning({ id: cards.id })
  if (result.length === 0) throw new HttpError(404, '卡片不存在', 'not_found')
}

export interface CardImage {
  mime: string
  data: Buffer
  etag: string
}

export async function getCardImage(
  userId: string,
  cardId: string,
  side: string,
): Promise<CardImage> {
  if (side !== 'front' && side !== 'back') throw new HttpError(404, '图片不存在', 'not_found')
  const rows = await db()
    .select({
      userId: cards.userId,
      createdAt: cards.createdAt,
      frontMime: cards.frontMime,
      frontData: cards.frontData,
      backMime: cards.backMime,
      backData: cards.backData,
    })
    .from(cards)
    .where(eq(cards.id, cardId))
    .limit(1)
  const row = rows[0]
  if (!row || row.userId !== userId) throw new HttpError(404, '图片不存在', 'not_found')
  const mime = side === 'front' ? row.frontMime : row.backMime
  const data = side === 'front' ? row.frontData : row.backData
  if (!mime || !data) throw new HttpError(404, '图片不存在', 'not_found')
  return { mime, data, etag: `"${cardId}-${side}"` }
}
