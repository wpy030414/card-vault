/**
 * 卡片自动定位：边缘 → 连通域 → 凸包 → 最小外接矩形。
 *
 * 目标不是通用目标检测，而是在“桌面/床面/手掌上拍一张卡”的典型场景里，
 * 找出由最长连续边缘围成的近似矩形。失败时返回保守的内缩全图，交给用户手动拖角。
 */

export interface Point {
  x: number
  y: number
}

export type Quad = [Point, Point, Point, Point]

export interface DetectionResult {
  /** 归一化坐标（0..1），顺序：左上、右上、右下、左下 */
  quad: Quad
  confidence: number
  areaRatio: number
  auto: boolean
}

export interface ImageDataLike {
  data: Uint8ClampedArray
  width: number
  height: number
}

interface HullPoint {
  x: number
  y: number
}

interface RectCandidate {
  corners: HullPoint[]
  width: number
  height: number
  areaRatio: number
  coverage: number
  score: number
}

function fallbackQuad(inset = 0.05): Quad {
  return [
    { x: inset, y: inset },
    { x: 1 - inset, y: inset },
    { x: 1 - inset, y: 0.94 },
    { x: inset, y: 0.94 },
  ]
}

function percentileOf(magnitude: Float32Array, ratio: number): number {
  const histogram = new Int32Array(256)
  for (let i = 0; i < magnitude.length; i++) {
    const value = Math.min(1, Math.max(0, magnitude[i]!))
    histogram[Math.min(255, Math.floor(value * 255))]!++
  }
  const target = Math.floor(magnitude.length * ratio)
  let count = 0
  for (let bin = 0; bin < 256; bin++) {
    count += histogram[bin]!
    if (count >= target) return (bin + 1) / 256
  }
  return 1
}

function sobel(gray: Float32Array, width: number, height: number): { magnitude: Float32Array; max: number } {
  const magnitude = new Float32Array(width * height)
  let max = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x0 = x === 0 ? 0 : x - 1
      const x2 = x === width - 1 ? width - 1 : x + 1
      const y0 = y === 0 ? 0 : y - 1
      const y2 = y === height - 1 ? height - 1 : y + 1
      const tl = gray[y0 * width + x0]!
      const tc = gray[y0 * width + x]!
      const tr = gray[y0 * width + x2]!
      const ml = gray[y * width + x0]!
      const mr = gray[y * width + x2]!
      const bl = gray[y2 * width + x0]!
      const bc = gray[y2 * width + x]!
      const br = gray[y2 * width + x2]!
      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br
      const value = Math.sqrt(gx * gx + gy * gy) / 4
      magnitude[y * width + x] = value
      if (value > max) max = value
    }
  }
  return { magnitude, max }
}

function dilate(src: Uint8Array, width: number, height: number): Uint8Array {
  const tmp = new Uint8Array(src.length)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      if (!src[row + x]) continue
      tmp[row + x] = 1
      if (x > 0) tmp[row + x - 1] = 1
      if (x < width - 1) tmp[row + x + 1] = 1
    }
  }
  const out = new Uint8Array(src.length)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      if (!tmp[row + x]) continue
      out[row + x] = 1
      if (y > 0) out[row - width + x] = 1
      if (y < height - 1) out[row + width + x] = 1
    }
  }
  return out
}

function convexHull(points: HullPoint[]): HullPoint[] {
  if (points.length <= 2) return points
  points.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
  const cross = (o: HullPoint, a: HullPoint, b: HullPoint) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: HullPoint[] = []
  for (const p of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: HullPoint[] = []
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

function minAreaRect(hull: HullPoint[]): RectCandidate | null {
  if (hull.length < 3) return null
  let best: { area: number; ux: number; uy: number; vx: number; vy: number; minU: number; maxU: number; minV: number; maxV: number } | null =
    null
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!
    const b = hull[(i + 1) % hull.length]!
    const ex = b.x - a.x
    const ey = b.y - a.y
    const len = Math.hypot(ex, ey)
    if (len < 1e-6) continue
    const ux = ex / len
    const uy = ey / len
    const vx = -uy
    const vy = ux
    let minU = Infinity
    let maxU = -Infinity
    let minV = Infinity
    let maxV = -Infinity
    for (const p of hull) {
      const u = p.x * ux + p.y * uy
      const v = p.x * vx + p.y * vy
      if (u < minU) minU = u
      if (u > maxU) maxU = u
      if (v < minV) minV = v
      if (v > maxV) maxV = v
    }
    const area = (maxU - minU) * (maxV - minV)
    if (!best || area < best.area) best = { area, ux, uy, vx, vy, minU, maxU, minV, maxV }
  }
  if (!best) return null
  const centerU = (best.minU + best.maxU) / 2
  const centerV = (best.minV + best.maxV) / 2
  const cx = best.ux * centerU + best.vx * centerV
  const cy = best.uy * centerU + best.vy * centerV
  const hw = (best.maxU - best.minU) / 2
  const hh = (best.maxV - best.minV) / 2
  const corners = [
    { x: cx - best.ux * hw - best.vx * hh, y: cy - best.uy * hw - best.vy * hh },
    { x: cx + best.ux * hw - best.vx * hh, y: cy + best.uy * hw - best.vy * hh },
    { x: cx + best.ux * hw + best.vx * hh, y: cy + best.uy * hw + best.vy * hh },
    { x: cx - best.ux * hw + best.vx * hh, y: cy - best.uy * hw + best.vy * hh },
  ]
  return {
    corners,
    width: hw * 2,
    height: hh * 2,
    areaRatio: 0,
    coverage: 0,
    score: 0,
  }
}

function orderCorners(corners: HullPoint[]): Quad {
  const tl = corners.reduce((best, p) => (p.x + p.y < best.x + best.y ? p : best))
  const br = corners.reduce((best, p) => (p.x + p.y > best.x + best.y ? p : best))
  const tr = corners.reduce((best, p) => (p.x - p.y > best.x - best.y ? p : best))
  const bl = corners.reduce((best, p) => (p.x - p.y < best.x - best.y ? p : best))
  return [tl, tr, br, bl]
}

/** 沿矩形四条边取样，统计附近存在边缘像素的比例 */
function perimeterCoverage(edges: Uint8Array, width: number, height: number, corners: HullPoint[]): number {
  const samples = 22
  const skip = 0.1
  let hit = 0
  let total = 0
  for (let side = 0; side < 4; side++) {
    const a = corners[side]!
    const b = corners[(side + 1) % 4]!
    for (let s = 0; s < samples; s++) {
      const t = skip + (s / (samples - 1)) * (1 - skip * 2)
      const x = Math.round(a.x + (b.x - a.x) * t)
      const y = Math.round(a.y + (b.y - a.y) * t)
      total++
      let found = false
      for (let dy = -2; dy <= 2 && !found; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const px = x + dx
          const py = y + dy
          if (px < 0 || py < 0 || px >= width || py >= height) continue
          if (edges[py * width + px]) {
            found = true
            break
          }
        }
      }
      if (found) hit++
    }
  }
  return total === 0 ? 0 : hit / total
}

export function detectCardQuad(image: ImageDataLike): DetectionResult {
  const { width, height, data } = image
  const pixels = width * height
  if (width < 24 || height < 24 || pixels === 0) {
    return { quad: fallbackQuad(), confidence: 0, areaRatio: 0, auto: false }
  }

  const gray = new Float32Array(pixels)
  for (let i = 0, p = 0; i < pixels; i++, p += 4) {
    gray[i] = (data[p]! * 0.299 + data[p + 1]! * 0.587 + data[p + 2]! * 0.114) / 255
  }

  const { magnitude, max } = sobel(gray, width, height)
  if (max < 0.02) {
    return { quad: fallbackQuad(), confidence: 0, areaRatio: 0, auto: false }
  }

  const pct = percentileOf(magnitude, 0.86) * max
  const threshold = Math.max(pct, 0.055 * Math.max(0.35, max))
  const edges = new Uint8Array(pixels)
  for (let i = 0; i < pixels; i++) {
    if (magnitude[i]! >= threshold) edges[i] = 1
  }
  const dilated = dilate(dilate(edges, width, height), width, height)

  // 连通域（8 邻域），只为面积够大的域计算凸包
  const labels = new Int32Array(pixels).fill(-1)
  const stack = new Int32Array(pixels)
  const candidates: RectCandidate[] = []
  let compId = 0

  for (let start = 0; start < pixels; start++) {
    if (!dilated[start] || labels[start] !== -1) continue
    let top = 0
    stack[top++] = start
    labels[start] = compId
    const points: HullPoint[] = []
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0
    while (top > 0) {
      const index = stack[--top]!
      const x = index % width
      const y = (index / width) | 0
      points.push({ x, y })
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          const nindex = ny * width + nx
          if (dilated[nindex] && labels[nindex] === -1) {
            labels[nindex] = compId
            stack[top++] = nindex
          }
        }
      }
    }
    compId++
    if (points.length < 48) continue
    const bboxRatio = ((maxX - minX + 1) * (maxY - minY + 1)) / pixels
    if (bboxRatio < 0.012) continue
    const hull = convexHull(points)
    const rect = minAreaRect(hull)
    if (!rect) continue
    const areaRatio = (rect.width * rect.height) / pixels
    if (areaRatio < 0.012 || areaRatio > 1.0) continue
    const coverage = perimeterCoverage(dilated, width, height, rect.corners)
    const aspect = rect.width / rect.height
    const aspectWeight = aspect >= 0.4 && aspect <= 2.2 ? 1 : 0.45
    const score = areaRatio * coverage * coverage * aspectWeight
    candidates.push({ ...rect, areaRatio, coverage, score })
  }

  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  if (!best || best.coverage < 0.46 || best.areaRatio < 0.02) {
    return { quad: fallbackQuad(), confidence: 0, areaRatio: best?.areaRatio ?? 0, auto: false }
  }

  const quad = orderCorners(best.corners).map((p) => ({
    x: Math.min(1, Math.max(0, p.x / width)),
    y: Math.min(1, Math.max(0, p.y / height)),
  })) as Quad
  const confidence = Math.min(0.99, 0.3 + best.coverage * 0.55 + Math.min(0.6, best.areaRatio) * 0.25)
  return { quad, confidence, areaRatio: best.areaRatio, auto: true }
}
