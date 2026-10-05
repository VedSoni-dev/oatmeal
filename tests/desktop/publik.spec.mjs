import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('publik: consent, balance, 402 action and successful retry across the secure bridge', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'oatmeal-publik-ui-'))
  const env = {
    ...process.env,
    OATMEAL_TEST_DATA: profile,
    PUBLIK_APP_TOKEN: 'pat_test_public',
  }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.PUBLIK_API_KEY
  delete env.PUBLIK_API_BASE_URL
  const app = await electron.launch({ args: [resolve('.')], env })
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    // Mock only the external service; exercise the actual main process, storage,
    // preload serialization, renderer, and cloud consent handlers.
    await app.evaluate(() => {
      globalThis.publikRequests = []
      globalThis.publikLinked = false
      globalThis.fetch = async (url, options = {}) => {
        if (!url.startsWith('https://publikhq.com/api/v1/'))
          throw new Error('Unexpected network request')
        globalThis.publikRequests.push(new URL(url).pathname)
        if (url.endsWith('/installs'))
          return Response.json(
            {
              key: 'pk_test_never_to_renderer',
              base_url: 'https://publikhq.com/api/v1',
              balance_micros: 0,
              claim_state: 'anonymous',
              claim_url: 'https://publikhq.com/claim/test',
              disclosure: {
                cost: 'oatmeal-vedsoni-dev runs on publik API by default: the AI model behind it is run by a provider that charges per use, and publik charges a fixed, published price for it \u2014 above what the model costs publik, with the difference shared with the developer who built oatmeal-vedsoni-dev \u2014 from your publik balance. A new computer starts at $0.00 and no card is asked for: linking this computer to your publik account gives $0.05 of free use, once, and a plan, a pack or your own key takes it from there; nothing is charged behind your back, and when the balance runs out oatmeal-vedsoni-dev tells you and keeps working with your own key \u2014 most people spend under $2 a month.',
              },
            },
            { status: 201 },
          )
        if (url.endsWith('/wallet') && globalThis.publikWalletBlocked)
          return Response.json(
            {
              error: {
                message: 'Check your publik account.',
                top_up_url: 'https://publikhq.com/dashboard/api',
              },
            },
            { status: 402 },
          )
        if (url.endsWith('/wallet'))
          return Response.json({
            balance_micros: 50000,
            claim_state: 'claimed',
            add_credit_url: 'https://publikhq.com/dashboard/api',
          })
        if (url.endsWith('/chat/completions')) {
          if (!globalThis.publikLinked)
            return Response.json(
              {
                error: {
                  message: 'Link this computer to get started.',
                  top_up_url: 'https://publikhq.com/claim/test',
                },
              },
              { status: 402 },
            )
          return Response.json(
            {
              choices: [
                {
                  message: {
                    content: '## Summary\nMaya owns the onboarding draft.',
                  },
                },
              ],
            },
            {
              headers: {
                'x-publik-balance': '0.049',
                'x-publik-charge-micros': '1000',
              },
            },
          )
        }
        throw new Error('Unexpected endpoint')
      }
    })
    await page.getByRole('button', { name: 'Start a meeting' }).click()
    await page
      .getByRole('textbox', { name: 'Your meeting notes' })
      .fill('Maya owns the onboarding draft.')
    await expect(page.locator('#save-status')).toHaveText('Saved locally')
    await page.locator('#settings-open').click()
    await page.getByLabel('Provider', { exact: true }).selectOption('publik')
    await expect(page.locator('#publik-disclosure')).toContainText(
      'priced per use in dollars',
    )
    expect(await app.evaluate(() => globalThis.publikRequests)).toEqual([])
    await page.screenshot({ path: 'test-results/publik-consent.png' })
    await page
      .getByRole('button', { name: 'Accept & set up publik API' })
      .click()
    await expect(page.locator('#publik-balance')).toContainText(
      '$0.00 until linked',
    )
    await expect(page.locator('#publik-cost')).toHaveText(
      'oatmeal-vedsoni-dev runs on publik API by default: the AI model behind it is run by a provider that charges per use, and publik charges a fixed, published price for it \u2014 above what the model costs publik, with the difference shared with the developer who built oatmeal-vedsoni-dev \u2014 from your publik balance. A new computer starts at $0.00 and no card is asked for: linking this computer to your publik account gives $0.05 of free use, once, and a plan, a pack or your own key takes it from there; nothing is charged behind your back, and when the balance runs out oatmeal-vedsoni-dev tells you and keeps working with your own key \u2014 most people spend under $2 a month.',
    )
    await expect(
      page.getByRole('button', { name: 'Link this computer & pick a plan' }),
    ).toBeVisible()
    const safeState = await page.evaluate(async () =>
      JSON.stringify(await window.oatmeal.publikStatus()),
    )
    expect(safeState).not.toContain('pk_test')
    await page.screenshot({ path: 'test-results/publik-balance.png' })
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(820, 600),
    )
    await expect(
      page.getByRole('button', { name: 'Save settings' }),
    ).toBeInViewport()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({ path: 'test-results/publik-compact.png' })
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1180, 800),
    )
    await page.getByRole('button', { name: 'Save settings' }).click()
    await page.getByRole('tab', { name: 'Summary' }).click()
    await page.getByRole('button', { name: 'Generate notes' }).click()
    await page.locator('#consent-accept').click()
    await expect(page.locator('#publik-credit-dialog')).toBeVisible()
    await expect(page.locator('#publik-credit-message')).toHaveText(
      'Link this computer to get started.',
    )
    await expect(page.locator('#publik-credit-link')).toBeVisible()
    await page.screenshot({ path: 'test-results/publik-empty-balance.png' })
    await page.getByRole('button', { name: 'Change provider' }).click()
    await expect(page.locator('#settings-dialog')).toBeVisible()
    await app.evaluate(() => {
      globalThis.publikWalletBlocked = true
    })
    await page.getByRole('button', { name: 'Refresh balance' }).click()
    await expect(page.locator('#publik-error-message')).toHaveText(
      'Check your publik account.',
    )
    await expect(page.locator('#publik-link')).not.toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Refresh balance' }),
    ).toBeVisible()
    await app.evaluate(() => {
      globalThis.publikLinked = true
      globalThis.publikWalletBlocked = false
    })
    await page.getByRole('button', { name: 'Refresh balance' }).click()
    await expect(page.locator('#publik-balance')).toHaveText(
      '$0.05 of publik balance',
    )
    await expect(page.locator('#publik-link')).toHaveText('Add a plan or pack')
    await page.getByRole('button', { name: 'Save settings' }).click()
    await page.getByRole('button', { name: 'Generate notes' }).click()
    await page.locator('#consent-accept').click()
    await expect(page.locator('#summary-output')).toContainText(
      'Maya owns the onboarding draft.',
    )
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
