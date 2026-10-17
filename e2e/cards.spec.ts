import { expect, test } from '@playwright/test'
import {
  addCard,
  choosePhoto,
  loginDev,
  makeCardPhoto,
  openUpload,
  resetCards,
  sampleStoredImage,
} from './helpers.ts'

test.describe('收录卡片', () => {
  test('自动识别卡面 → 拉正 → 题名入库', async ({ page }) => {
    await loginDev(page)
    await resetCards(page)

    const photo = await makeCardPhoto(page)
    await openUpload(page)
    await choosePhoto(page, 'front', photo)
    await page.getByRole('button', { name: /开始裁切/ }).click()
    await expect(page.locator('.detect-badge')).toContainText('自动识别', { timeout: 20_000 })

    await page.getByRole('button', { name: /下一步/ }).click()
    await expect(page.locator('.details-grid')).toBeVisible()
    await page.locator('#card-title').fill('透视拉正测试卡')
    await page.locator('#card-date').fill('2026-10-18')
    await page.getByRole('button', { name: /收入匣中/ }).click()

    await expect(page.locator('.toast')).toContainText('透视拉正测试卡')
    await expect(page.locator('.ring-card')).toHaveCount(1)

    const stored = await page.evaluate(() => fetch('/api/cards').then((response) => response.json()))
    const card = (stored.cards as Array<{ id: string; title: string; front: { url: string; width: number; height: number } }>).find(
      (item) => item.title === '透视拉正测试卡',
    )
    expect(card).toBeTruthy()
    const sample = await sampleStoredImage(page, card!.front.url)
    // 拉正后的成片应当填满卡面，四角是卡纸/金边而不是桌面
    expect(sample.ratio).toBeGreaterThan(0.55)
    expect(sample.ratio).toBeLessThan(0.85)
    expect(sample.cornerMin).toBeGreaterThan(0.22)
    expect(sample.average).toBeGreaterThan(0.2)
    expect(Math.max(sample.width, sample.height)).toBeLessThanOrEqual(1601)
  })

  test('正反两面都收录后可以翻面端详', async ({ page }) => {
    await loginDev(page)
    await resetCards(page)

    const frontPhoto = await makeCardPhoto(page, -8)
    const backPhoto = await makeCardPhoto(page, 7)
    await openUpload(page)
    await choosePhoto(page, 'front', frontPhoto)
    await choosePhoto(page, 'back', backPhoto)
    await page.getByRole('button', { name: /开始裁切/ }).click()
    await expect(page.locator('.detect-badge')).toContainText('自动识别')
    await page.getByRole('button', { name: /下一步/ }).click()
    await expect(page.locator('.crop-side')).toContainText('背面')
    await expect(page.locator('.detect-badge')).toContainText('自动识别')
    await page.getByRole('button', { name: /下一步/ }).click()

    await page.locator('#card-title').fill('双面典藏卡')
    await page.getByRole('button', { name: /收入匣中/ }).click()
    await expect(page.locator('.toast')).toContainText('双面典藏卡')

    const stored = await page.evaluate(() => fetch('/api/cards').then((response) => response.json()))
    const card = (stored.cards as Array<{ title: string; back: unknown }>).find((item) => item.title === '双面典藏卡')
    expect(card?.back).toBeTruthy()

    await page.locator('.ring-card').first().click()
    await expect(page.locator('.examine')).toBeVisible()
    await page.waitForTimeout(450)
    await page.locator('.examine-flip').click()
    await expect(page.locator('.examine-flip')).toHaveClass(/is-flipped/)
    await page.locator('.examine-flip').click()
    await expect(page.locator('.examine-flip')).not.toHaveClass(/is-flipped/)
  })

  test('收录后刷新仍在；两次点击删除', async ({ page }) => {
    await loginDev(page)
    await resetCards(page)
    await addCard(page, '待删除卡', { withBack: true })
    await page.reload()

    await expect(page.locator('.ring-card')).toHaveCount(1)
    await page.reload()
    await expect(page.locator('.ring-card')).toHaveCount(1)

    await page.locator('.ring-card').first().click()
    await expect(page.locator('.examine')).toBeVisible()
    await page.getByRole('button', { name: '卡片菜单' }).click()
    await page.getByRole('menuitem', { name: '删除' }).click()
    await page.getByRole('button', { name: '确认删除' }).click()

    await expect(page.locator('.examine')).toHaveCount(0)
    await expect(page.locator('.ring-card')).toHaveCount(0)
    await expect(page.getByText('匣中尚无藏品')).toBeVisible()

    const stored = await page.evaluate(() => fetch('/api/cards').then((response) => response.json()))
    expect(stored.cards).toEqual([])
  })

  test('端详菜单可以编辑标题与日期', async ({ page }) => {
    await loginDev(page)
    await resetCards(page)
    await addCard(page, '编辑前的卡', { withBack: false })
    await page.reload()

    await page.locator('.ring-card').first().click()
    await expect(page.locator('.examine')).toBeVisible()
    await page.getByRole('button', { name: '卡片菜单' }).click()
    await page.getByRole('menuitem', { name: '编辑' }).click()

    await page.getByLabel('标题').fill('编辑后的卡')
    await page.getByLabel('日期').fill('2026-02-02')
    await page.getByRole('button', { name: '保存', exact: true }).click()

    await expect(page.locator('.examine-title')).toHaveText('编辑后的卡')
    const stored = await page.evaluate(() => fetch('/api/cards').then((response) => response.json()))
    expect(stored.cards[0].title).toBe('编辑后的卡')
    expect(stored.cards[0].cardDate).toBe('2026-02-02')
  })

  test('读取失败的图片不会打开裁切步骤', async ({ page }) => {
    await loginDev(page)
    await resetCards(page)
    await openUpload(page)
    await page.locator('input[type=file]').first().setInputFiles({
      name: 'broken.png',
      mimeType: 'image/png',
      buffer: Buffer.from('not an image'),
    })
    await expect(page.locator('.toast')).toContainText(/无法解码|图片/, { timeout: 15_000 })
    await expect(page.getByRole('button', { name: /开始裁切/ })).toBeDisabled()
  })
})
