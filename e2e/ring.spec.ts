import { expect, test } from '@playwright/test'
import {
  BASE_URL,
  addCard,
  frontCard,
  flickRing,
  loginDev,
  pullUpCard,
  resetCards,
  ringAngle,
  ringStep,
} from './helpers.ts'

test.describe('圆环与端详', () => {
  test('拨动旋转、轻点停驻、上滑端详、翻面与彩光', async ({ page }) => {
    await loginDev(page)
    await resetCards(page)
    for (const title of ['壹号卡', '贰号卡', '叁号卡', '肆号卡', '伍号卡']) {
      await addCard(page, title, { withBack: true, holo: true })
    }
    await page.reload()
    await expect(page.locator('.ring-card')).toHaveCount(5)

    // 先端详：此时圆环停在第 0 张，上滑手势最稳定
    const card = await frontCard(page)
    await pullUpCard(page, card)
    await expect(page.locator('.examine')).toBeVisible()
    await expect(page.locator('.vault')).toHaveClass(/is-examining/)

    await page.waitForTimeout(500)
    await page.locator('.examine-flip').click()
    await expect(page.locator('.examine-flip')).toHaveClass(/is-flipped/)

    await page.keyboard.press('h')
    await expect(page.locator('.examine-card-shell')).toHaveClass(/is-holo/)
    await page.waitForTimeout(2200)
    await expect(page.locator('.examine-card-shell')).not.toHaveClass(/is-holo/)

    await page.getByRole('button', { name: '关闭端详' }).click()
    await expect(page.locator('.examine')).toHaveCount(0)
    await expect(page.locator('.vault')).not.toHaveClass(/is-examining/)
    await page.waitForTimeout(700)

    // 再验证拨动与轻点停驻
    const before = await ringAngle(page)
    await flickRing(page)
    await page.waitForTimeout(160)
    const afterFlick = await ringAngle(page)
    expect(afterFlick).not.toBe(before)

    const stage = page.locator('.ring-stage')
    const box = await stage.boundingBox()
    if (!box) throw new Error('舞台不可见')
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    const step = await ringStep(page)
    expect(step).toBeGreaterThan(6)
    await expect
      .poll(async () => {
        const angle = await ringAngle(page)
        const remainder = ((angle % step) + step) % step
        return Math.min(remainder, step - remainder)
      })
      .toBeLessThan(0.75)
    await page.waitForTimeout(900)
    const settled = await ringAngle(page)
    const remainder = ((settled % step) + step) % step
    expect(Math.min(remainder, step - remainder)).toBeLessThan(0.01)
  })

  test('手机端轻点端详不会误触翻面，上传面板可用', async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
    })
    const page = await context.newPage()
    await loginDev(page)
    await resetCards(page)
    await addCard(page, '手机端测试卡', { withBack: true })
    await page.reload()

    const card = await frontCard(page)
    await card.tap()
    await expect(page.locator('.examine')).toBeVisible()
    await page.waitForTimeout(520)
    await expect(page.locator('.examine-flip')).not.toHaveClass(/is-flipped/)

    await page.locator('.examine-flip').tap()
    await expect(page.locator('.examine-flip')).toHaveClass(/is-flipped/)

    await page.getByRole('button', { name: '关闭端详' }).tap()
    await expect(page.locator('.examine')).toHaveCount(0)

    await page.locator('.add-fab').tap()
    await expect(page.locator('.sheet')).toBeVisible()
    await expect(page.getByRole('button', { name: /开始裁切/ })).toBeVisible()
    await page.locator('.sheet .icon-btn').first().tap()
    await expect(page.locator('.sheet')).toHaveCount(0)

    await context.close()
  })
})
