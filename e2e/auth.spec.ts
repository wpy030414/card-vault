import { expect, test } from '@playwright/test'
import { loginDev } from './helpers.ts'

test.describe('登录与访问控制', () => {
  test('未登录时看不到圆环，接口返回 401', async ({ page, request }) => {
    await page.goto('/')
    await expect(page.getByText('使用 QQ 登录 CardVault')).toBeVisible()
    await expect(page.locator('.vault')).toHaveCount(0)

    expect((await request.get('/api/me')).status()).toBe(401)
    expect((await request.get('/api/cards')).status()).toBe(401)
    expect((await request.get('/api/crop-presets')).status()).toBe(401)
    expect((await request.get('/media/00000000-0000-0000-0000-000000000000/front')).status()).toBe(401)
  })

  test('开发登录后刷新保持会话，退出后立即失效', async ({ page }) => {
    await loginDev(page)
    await expect(page.getByRole('button', { name: /收录新卡|收录第一张卡/ })).toBeVisible()

    await page.reload()
    await expect(page.locator('.vault')).toBeVisible()

    await page.getByRole('button', { name: '收藏匣菜单' }).click()
    await page.getByRole('button', { name: '退出登录' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '退出登录' }).click()
    await expect(page.getByText('使用 QQ 登录 CardVault')).toBeVisible()
    expect((await page.request.get('/api/me')).status()).toBe(401)
  })

  test('永久会话在页面加载时滚动续期', async ({ page }) => {
    await loginDev(page)
    const me = await page.request.get('/api/me')
    expect(me.status()).toBe(200)
    const setCookie = me.headers()['set-cookie'] ?? ''
    expect(setCookie).toContain('cv_session=')
    const maxAge = Number(/Max-Age=(\d+)/.exec(setCookie)?.[1] ?? 0)
    // 浏览器上限 400 天；只要远大于原来的 30 天即可证明永久模式生效
    expect(maxAge).toBeGreaterThan(300 * 24 * 60 * 60)
  })

  test('扫码二维码由腾讯网页登录服务下发', async ({ request }) => {
    const created = await request.post('/api/auth/qq/qr')
    test.skip(!created.ok(), `腾讯 QQ 登录服务暂不可用（HTTP ${created.status()}）`)
    const body = (await created.json()) as { token: string; image: string; expiresAt: number }
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{16,64}$/)
    expect(body.image).toMatch(/^data:image\/png;base64,/)
    expect(body.expiresAt).toBeGreaterThan(Date.now())

    const polled = await request.get(`/api/auth/qq/qr/${encodeURIComponent(body.token)}`)
    expect(polled.status()).toBe(200)
    const pollBody = (await polled.json()) as { status: string }
    expect(['pending', 'scanned', 'expired']).toContain(pollBody.status)
  })
})
