import { expect, test } from '@playwright/test'
import {
  choosePhoto,
  loginDev,
  makeCardPhoto,
  openPresetManager,
  openUpload,
  resetCards,
  resetPresets,
  sampleStoredImage,
} from './helpers.ts'

test.describe('自定义裁切模式', () => {
  test('从主页菜单创建、持久化并删除', async ({ page }) => {
    await loginDev(page)
    await resetCards(page)
    await resetPresets(page)
    await page.reload()
    await expect(page.locator('.vault')).toBeVisible()

    const photo = await makeCardPhoto(page)
    await openPresetManager(page)
    await expect(page.getByText('还没有自定义裁切模式')).toBeVisible()

    await page.getByRole('button', { name: /新建模式/ }).click()
    await page.locator('#preset-name').fill('深色桌面 · 左上斜放')
    await page.locator('.preset-sheet input[type=file]').setInputFiles({
      name: 'preset.png',
      mimeType: 'image/png',
      buffer: photo,
    })
    await expect(page.locator('.crop-line')).toBeVisible()
    await page.getByRole('button', { name: /保存模式/ }).click()

    await expect(page.locator('.preset-item-text strong')).toHaveText('深色桌面 · 左上斜放')

    const created = await page.evaluate(() => fetch('/api/crop-presets').then((response) => response.json()))
    expect(created.presets).toHaveLength(1)
    expect(created.presets[0].quad).toHaveLength(4)

    // 关掉弹窗、刷新页面，模式仍在且仍能从主页菜单进入
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    await page.reload()
    await expect(page.locator('.vault')).toBeVisible()
    await openPresetManager(page)
    await expect(page.locator('.preset-item-text strong')).toHaveText('深色桌面 · 左上斜放')

    await page.getByRole('button', { name: '删除模式 深色桌面 · 左上斜放' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '确认删除' }).click()
    await expect(page.getByText('还没有自定义裁切模式')).toBeVisible()
    const remaining = await page.evaluate(() => fetch('/api/crop-presets').then((response) => response.json()))
    expect(remaining.presets).toEqual([])
  })

  test('非法四角与越界名称不会入库', async ({ page }) => {
    await loginDev(page)
    await resetPresets(page)

    const bowtie = await page.request.post('/api/crop-presets', {
      data: {
        name: '自交四边形',
        quad: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
      },
    })
    expect(bowtie.status()).toBe(400)

    const outside = await page.request.post('/api/crop-presets', {
      data: {
        name: '越界',
        quad: [
          { x: -0.2, y: 0.1 },
          { x: 0.8, y: 0.1 },
          { x: 0.8, y: 0.9 },
          { x: 0.2, y: 0.9 },
        ],
      },
    })
    expect(outside.status()).toBe(400)

    const missingName = await page.request.post('/api/crop-presets', {
      data: {
        name: '   ',
        quad: [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.1 },
          { x: 0.9, y: 0.9 },
          { x: 0.1, y: 0.9 },
        ],
      },
    })
    expect(missingName.status()).toBe(400)

    const list = await page.request.get('/api/crop-presets')
    expect((await list.json()).presets).toEqual([])
  })

  test('裁切页一键套用保存的相对落点', async ({ page }) => {
    await loginDev(page)
    await resetCards(page)
    await resetPresets(page)

    const quad = [
      { x: 0.25, y: 0.2 },
      { x: 0.75, y: 0.2 },
      { x: 0.75, y: 0.8 },
      { x: 0.25, y: 0.8 },
    ]
    const response = await page.request.post('/api/crop-presets', { data: { name: '正中竖幅', quad } })
    expect(response.status()).toBe(201)
    await page.reload()
    await expect(page.locator('.vault')).toBeVisible()

    const photo = await makeCardPhoto(page)
    await openUpload(page)
    await choosePhoto(page, 'front', photo)
    await page.getByRole('button', { name: /开始裁切/ }).click()

    const preset = page.getByRole('button', { name: /正中竖幅/ })
    await expect(preset).toBeVisible()
    await preset.click()
    await expect(preset).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('button', { name: /下一步/ }).click()
    await page.locator('#card-title').fill('模式套用测试卡')
    await page.getByRole('button', { name: /收入匣中/ }).click()
    await expect(page.locator('.toast')).toContainText('模式套用测试卡')

    const stored = await page.evaluate(() => fetch('/api/cards').then((response) => response.json()))
    const card = (stored.cards as Array<{ title: string; front: { url: string } }>).find(
      (item) => item.title === '模式套用测试卡',
    )
    expect(card).toBeTruthy()
    const sample = await sampleStoredImage(page, card!.front.url)
    // 模式在 1200×900 的照片上圈出 0.5 × 0.6 的区域，拉正后宽高比应约为 1.11
    expect(sample.ratio).toBeGreaterThan(1.03)
    expect(sample.ratio).toBeLessThan(1.2)
  })
})
