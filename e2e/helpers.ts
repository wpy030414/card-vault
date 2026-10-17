import { expect, type Locator, type Page } from '@playwright/test'

export const BASE_URL = 'http://127.0.0.1:4318'

export async function loginDev(page: Page): Promise<void> {
  await page.goto('/')
  const button = page.getByRole('button', { name: '开发模式直接进入' })
  await expect(button).toBeVisible({ timeout: 20_000 })
  await button.click()
  await expect(page.locator('.vault')).toBeVisible()
}

export async function resetCards(page: Page): Promise<void> {
  const payload = await page.evaluate(() => fetch('/api/cards').then((response) => response.json()))
  for (const card of payload.cards as Array<{ id: string }>) {
    await page.evaluate((id) => fetch(`/api/cards/${id}`, { method: 'DELETE' }), card.id)
  }
  await page.reload()
  await expect(page.locator('.vault')).toBeVisible()
}

export async function addCard(
  page: Page,
  title: string,
  options: { withBack?: boolean; holo?: boolean } = {},
): Promise<{ id: string; title: string; back: { url: string } | null; front: { url: string; width: number; height: number } }> {
  return page.evaluate(
    async ({ title, withBack, holo }) => {
      const make = (label: string, back: boolean) => {
        const canvas = document.createElement('canvas')
        canvas.width = 600
        canvas.height = 840
        const ctx = canvas.getContext('2d')!
        let hash = 0
        for (const ch of label) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
        const hue = hash % 360
        if (back) {
          const bg = ctx.createLinearGradient(0, 0, 600, 840)
          bg.addColorStop(0, `hsl(${hue} 45% 18%)`)
          bg.addColorStop(1, `hsl(${hue + 20} 55% 10%)`)
          ctx.fillStyle = bg
          ctx.fillRect(0, 0, 600, 840)
          ctx.strokeStyle = 'rgba(240,210,150,.55)'
          for (let radius = 50; radius < 340; radius += 26) {
            ctx.beginPath()
            ctx.arc(300, 380, radius, 0, Math.PI * 2)
            ctx.stroke()
          }
          ctx.fillStyle = 'rgba(246,227,168,.85)'
          ctx.font = '600 52px serif'
          ctx.textAlign = 'center'
          ctx.fillText('CardVault', 300, 400)
        } else {
          const bg = ctx.createLinearGradient(0, 0, 600, 840)
          bg.addColorStop(0, `hsl(${hue} 45% 26%)`)
          bg.addColorStop(0.55, `hsl(${hue + 24} 50% 38%)`)
          bg.addColorStop(1, `hsl(${hue} 45% 20%)`)
          ctx.fillStyle = bg
          ctx.fillRect(0, 0, 600, 840)
          const glow = ctx.createRadialGradient(300, 340, 10, 300, 340, 190)
          glow.addColorStop(0, `hsl(${hue + 60} 90% 72%)`)
          glow.addColorStop(1, 'rgba(255,255,255,0)')
          ctx.fillStyle = glow
          ctx.beginPath()
          ctx.arc(300, 340, 190, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = '#0e0b09'
          ctx.font = '600 56px serif'
          ctx.textAlign = 'center'
          ctx.fillText(label.slice(0, 10).toUpperCase(), 300, 630)
        }
        ctx.strokeStyle = 'rgba(232,200,140,.85)'
        ctx.lineWidth = 8
        ctx.strokeRect(16, 16, 568, 808)
        return canvas.toDataURL('image/jpeg', 0.9)
      }

      const response = await fetch('/api/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          cardDate: '2026-01-01',
          holo,
          front: { dataUrl: make(title, false), width: 600, height: 840 },
          back: withBack ? { dataUrl: make(title, true), width: 600, height: 840 } : null,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? '创建测试卡片失败')
      return payload.card
    },
    { title, withBack: Boolean(options.withBack), holo: Boolean(options.holo) },
  )
}

/** 生成一张“桌面上的斜放卡片”照片，用于测试自动识别与透视拉正 */
export async function makeCardPhoto(page: Page, tiltDeg = -8): Promise<Buffer> {
  const dataUrl = await page.evaluate((tilt) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 900
    const ctx = canvas.getContext('2d')!
    const bg = ctx.createLinearGradient(0, 0, 1200, 900)
    bg.addColorStop(0, '#2a1a12')
    bg.addColorStop(0.5, '#3b2518')
    bg.addColorStop(1, '#1d120c')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, 1200, 900)
    for (let i = 0; i < 120; i++) {
      ctx.strokeStyle = `rgba(${90 + Math.random() * 50},${55 + Math.random() * 30},${30 + Math.random() * 20},${0.02 + Math.random() * 0.04})`
      ctx.lineWidth = 1 + Math.random()
      const y = Math.random() * 900
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.bezierCurveTo(300, y + 30, 800, y - 30, 1200, y)
      ctx.stroke()
    }
    ctx.save()
    ctx.translate(600, 450)
    ctx.rotate((tilt * Math.PI) / 180)
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = 50
    ctx.shadowOffsetY = 24
    const round = (x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + w, y, x + w, y + h, r)
      ctx.arcTo(x + w, y + h, x, y + h, r)
      ctx.arcTo(x, y + h, x, y, r)
      ctx.arcTo(x, y, x + w, y, r)
      ctx.closePath()
    }
    const face = ctx.createLinearGradient(-210, -300, 210, 300)
    face.addColorStop(0, '#f7edd7')
    face.addColorStop(0.6, '#ead9b7')
    face.addColorStop(1, '#d9c49c')
    round(-210, -300, 420, 600, 24)
    ctx.fillStyle = face
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.strokeStyle = '#b08a4e'
    ctx.lineWidth = 8
    round(-200, -290, 400, 580, 20)
    ctx.stroke()
    ctx.fillStyle = '#2e3550'
    ctx.fillRect(-180, -270, 360, 340)
    const sun = ctx.createRadialGradient(-30, -120, 10, -30, -120, 170)
    sun.addColorStop(0, '#f6e6a8')
    sun.addColorStop(0.5, '#d9a94f')
    sun.addColorStop(1, 'rgba(120,70,30,0)')
    ctx.fillStyle = sun
    ctx.beginPath()
    ctx.arc(-30, -120, 170, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#f6e6a8'
    ctx.beginPath()
    ctx.arc(-30, -120, 62, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#25304e'
    ctx.font = 'bold 44px serif'
    ctx.textAlign = 'center'
    ctx.fillText('AURORA', 0, 140)
    ctx.font = '18px serif'
    ctx.fillStyle = '#8a6b3c'
    ctx.fillText('FIRST EDITION · 001', 0, 180)
    ctx.restore()
    return canvas.toDataURL('image/png')
  }, tiltDeg)
  return Buffer.from(dataUrl.split(',')[1]!, 'base64')
}

export async function openUpload(page: Page): Promise<void> {
  const fab = page.locator('.add-fab')
  if (await fab.count()) await fab.click()
  else await page.getByRole('button', { name: /收录第一张卡/ }).click()
  await expect(page.locator('.sheet')).toBeVisible()
}

export async function choosePhoto(page: Page, side: 'front' | 'back', buffer: Buffer): Promise<void> {
  const index = side === 'front' ? 0 : 1
  await page.locator('input[type=file]').nth(index).setInputFiles({
    name: `${side}.png`,
    mimeType: 'image/png',
    buffer,
  })
  await expect(page.locator('.pick-slot img').nth(index === 0 ? 0 : 1)).toBeVisible()
}

export async function frontCard(page: Page): Promise<Locator> {
  const cards = page.locator('.ring-card')
  const count = await cards.count()
  const viewport = page.viewportSize() ?? { width: 1280, height: 900 }
  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < count; index++) {
    const box = await cards.nth(index).boundingBox()
    if (!box) continue
    const distance =
      Math.abs(box.x + box.width / 2 - viewport.width / 2) + Math.abs(box.y + box.height / 2 - viewport.height / 2)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  }
  return cards.nth(bestIndex)
}

export async function ringAngle(page: Page): Promise<number> {
  const value = await page.locator('.ring-deck').evaluate((element) => (element as HTMLElement).dataset.angle)
  return value == null ? Number.NaN : Number(value)
}

export async function ringStep(page: Page): Promise<number> {
  const value = await page.locator('.ring-deck').evaluate((element) => (element as HTMLElement).dataset.step)
  return value == null ? Number.NaN : Number(value)
}

export async function flickRing(page: Page, distance = -320): Promise<void> {
  const stage = page.locator('.ring-stage')
  const box = await stage.boundingBox()
  if (!box) throw new Error('舞台不可见')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(x + (distance * step) / 8, y, { steps: 1 })
    await page.waitForTimeout(14)
  }
  await page.mouse.up()
}

export async function pullUpCard(page: Page, card: Locator): Promise<void> {
  const box = await card.boundingBox()
  if (!box) throw new Error('卡片不可见')
  const x = box.x + box.width / 2
  const startY = box.y + box.height * 0.7
  await page.mouse.move(x, startY)
  await page.mouse.down()
  for (let step = 1; step <= 10; step++) {
    await page.mouse.move(x, startY - step * 18, { steps: 1 })
    await page.waitForTimeout(12)
  }
  await page.mouse.up()
}

export async function sampleStoredImage(
  page: Page,
  url: string,
): Promise<{ width: number; height: number; ratio: number; cornerMin: number; average: number }> {
  return page.evaluate(async (source) => {
    const image = new Image()
    image.src = source
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0)
    const { width, height } = canvas
    const data = ctx.getImageData(0, 0, width, height).data
    const luminance = (fx: number, fy: number) => {
      const x = Math.max(0, Math.min(width - 1, Math.floor(width * fx)))
      const y = Math.max(0, Math.min(height - 1, Math.floor(height * fy)))
      const index = (y * width + x) * 4
      return (data[index]! * 0.299 + data[index + 1]! * 0.587 + data[index + 2]! * 0.114) / 255
    }
    const corners = [luminance(0.05, 0.05), luminance(0.95, 0.05), luminance(0.05, 0.95), luminance(0.95, 0.95)]
    let total = 0
    let count = 0
    for (let index = 0; index < data.length; index += 4 * 97) {
      total += (data[index]! * 0.299 + data[index + 1]! * 0.587 + data[index + 2]! * 0.114) / 255
      count++
    }
    return {
      width,
      height,
      ratio: width / height,
      cornerMin: Math.min(...corners),
      average: total / Math.max(1, count),
    }
  }, url)
}
