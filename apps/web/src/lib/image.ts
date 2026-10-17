import { detectCardQuad, type DetectionResult, type Point, type Quad } from './detectCard'

export interface PreparedImage {
  canvas: HTMLCanvasElement
  width: number
  height: number
  previewUrl: string
}

const MAX_WORK_SIDE = 2400
const MAX_OUTPUT_SIDE = 1600

/** 读文件 → 等比缩到可控尺寸的画布（同时用于裁切、检测与预览） */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件')
  if (file.size > 32 * 1024 * 1024) throw new Error('图片超过 32MB，请先压缩')
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.decoding = 'async'
  img.src = url
  try {
    await img.decode()
  } catch {
    URL.revokeObjectURL(url)
    throw new Error('浏览器无法解码这张图片，请改用 JPEG / PNG / WebP')
  }
  const naturalW = img.naturalWidth || img.width
  const naturalH = img.naturalHeight || img.height
  if (!naturalW || !naturalH) {
    URL.revokeObjectURL(url)
    throw new Error('图片尺寸异常')
  }
  const scale = Math.min(1, MAX_WORK_SIDE / Math.max(naturalW, naturalH))
  const width = Math.max(1, Math.round(naturalW * scale))
  const height = Math.max(1, Math.round(naturalH * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, width, height)
  URL.revokeObjectURL(url)
  return { canvas, width, height, previewUrl: canvas.toDataURL('image/jpeg', 0.86) }
}

/** 在缩小的工作图上做边缘检测，返回归一化四角 */
export function detectCard(prepared: PreparedImage): DetectionResult {
  const scale = Math.min(1, 480 / Math.max(prepared.width, prepared.height))
  const width = Math.max(24, Math.round(prepared.width * scale))
  const height = Math.max(24, Math.round(prepared.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')
  ctx.drawImage(prepared.canvas, 0, 0, width, height)
  const data = ctx.getImageData(0, 0, width, height)
  return detectCardQuad(data)
}

function unitSquareToQuad(quad: Point[]): number[] {
  const [p0, p1, p2, p3] = quad as [Point, Point, Point, Point]
  const dx1 = p1.x - p2.x
  const dx2 = p3.x - p2.x
  const sx = p0.x - p1.x + p2.x - p3.x
  const dy1 = p1.y - p2.y
  const dy2 = p3.y - p2.y
  const sy = p0.y - p1.y + p2.y - p3.y
  const den = dx1 * dy2 - dx2 * dy1
  if (Math.abs(den) < 1e-9) {
    return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  }
  const g = (sx * dy2 - dx2 * sy) / den
  const h = (dx1 * sy - sx * dy1) / den
  return [
    p1.x - p0.x + g * p1.x,
    p3.x - p0.x + h * p3.x,
    p0.x,
    p1.y - p0.y + g * p1.y,
    p3.y - p0.y + h * p3.y,
    p0.y,
    g,
    h,
  ]
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export interface WarpResult {
  dataUrl: string
  width: number
  height: number
}

/**
 * 把四角围成的区域用单应性变换拉正为矩形。
 * 用逐像素双线性采样而不是 canvas 的仿射变换，才能吃掉透视（斜着拍卡片）。
 */
export function warpCrop(prepared: PreparedImage, normalized: Quad): WarpResult {
  const sourceW = prepared.width
  const sourceH = prepared.height
  const quadPx = normalized.map((p) => ({
    x: Math.min(sourceW - 1, Math.max(0, p.x * sourceW)),
    y: Math.min(sourceH - 1, Math.max(0, p.y * sourceH)),
  })) as Quad

  const top = distance(quadPx[0], quadPx[1])
  const bottom = distance(quadPx[3], quadPx[2])
  const left = distance(quadPx[0], quadPx[3])
  const right = distance(quadPx[1], quadPx[2])
  const avgW = Math.max(24, (top + bottom) / 2)
  const avgH = Math.max(24, (left + right) / 2)
  const outScale = Math.min(MAX_OUTPUT_SIDE / Math.max(avgW, avgH), 1.6)
  const outW = Math.max(16, Math.round(avgW * outScale))
  const outH = Math.max(16, Math.round(avgH * outScale))

  const ctx = prepared.canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')
  const src = ctx.getImageData(0, 0, sourceW, sourceH)
  const srcData = src.data

  const transform = unitSquareToQuad(quadPx)
  const out = new ImageData(outW, outH)
  const dst = out.data

  for (let y = 0; y < outH; y++) {
    const v = (y + 0.5) / outH
    for (let x = 0; x < outW; x++) {
      const u = (x + 0.5) / outW
      const den = transform[6]! * u + transform[7]! * v + 1
      let sx = (transform[0]! * u + transform[1]! * v + transform[2]!) / den
      let sy = (transform[3]! * u + transform[4]! * v + transform[5]!) / den
      sx = Math.min(sourceW - 1, Math.max(0, sx))
      sy = Math.min(sourceH - 1, Math.max(0, sy))
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const x1 = Math.min(sourceW - 1, x0 + 1)
      const y1 = Math.min(sourceH - 1, y0 + 1)
      const fx = sx - x0
      const fy = sy - y0
      const i00 = (y0 * sourceW + x0) * 4
      const i10 = (y0 * sourceW + x1) * 4
      const i01 = (y1 * sourceW + x0) * 4
      const i11 = (y1 * sourceW + x1) * 4
      const w00 = (1 - fx) * (1 - fy)
      const w10 = fx * (1 - fy)
      const w01 = (1 - fx) * fy
      const w11 = fx * fy
      const a00 = srcData[i00 + 3]! / 255
      const a10 = srcData[i10 + 3]! / 255
      const a01 = srcData[i01 + 3]! / 255
      const a11 = srcData[i11 + 3]! / 255
      const alpha = a00 * w00 + a10 * w10 + a01 * w01 + a11 * w11
      const white = 255 * (1 - alpha)
      const r =
        srcData[i00]! * a00 * w00 +
        srcData[i10]! * a10 * w10 +
        srcData[i01]! * a01 * w01 +
        srcData[i11]! * a11 * w11 +
        white
      const g =
        srcData[i00 + 1]! * a00 * w00 +
        srcData[i10 + 1]! * a10 * w10 +
        srcData[i01 + 1]! * a01 * w01 +
        srcData[i11 + 1]! * a11 * w11 +
        white
      const b =
        srcData[i00 + 2]! * a00 * w00 +
        srcData[i10 + 2]! * a10 * w10 +
        srcData[i01 + 2]! * a01 * w01 +
        srcData[i11 + 2]! * a11 * w11 +
        white
      const index = (y * outW + x) * 4
      dst[index] = r
      dst[index + 1] = g
      dst[index + 2] = b
      dst[index + 3] = 255
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const outCtx = canvas.getContext('2d')
  if (!outCtx) throw new Error('当前浏览器不支持 Canvas')
  outCtx.putImageData(out, 0, 0)
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.9), width: outW, height: outH }
}
