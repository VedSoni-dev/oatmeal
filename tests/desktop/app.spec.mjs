import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('desktop notebook: create, edit, search, settings, restart, secure renderer', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'oatmeal-ui-'))
  const env = { ...process.env, OATMEAL_TEST_DATA: profile }
  delete env.ELECTRON_RUN_AS_NODE
  let app = await electron.launch({ args: [resolve('.')], env })
  let page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await expect(
      page.getByText('A little space', { exact: false }),
    ).toBeVisible()
    await page.screenshot({ path: 'test-results/welcome.png' })
    await page.getByRole('button', { name: 'Start a meeting' }).click()
    await page
      .getByRole('textbox', { name: 'Meeting title', exact: true })
      .fill('Design review')
    await page
      .getByRole('textbox', { name: 'Your meeting notes' })
      .fill('Ship the notebook on Friday. Maya owns the onboarding draft.')
    await expect(page.locator('#save-status')).toHaveText('Saved locally')
    await page.getByRole('tab', { name: 'Summary' }).click()
    await expect(
      page.getByRole('button', { name: 'Generate notes' }),
    ).toBeEnabled()
    await page.getByRole('tab', { name: 'Transcript' }).click()
    await expect(
      page.getByText('The conversation, in your words.'),
    ).toBeVisible()
    await page.getByRole('tab', { name: 'My notes' }).click()
    await page.screenshot({ path: 'test-results/meeting.png' })
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByLabel('Provider', { exact: true }).selectOption('openai')
    await page.getByLabel('Model ID').fill('gpt-4.1-mini')
    await page.screenshot({ path: 'test-results/settings.png' })
    await page.getByRole('button', { name: 'Save settings' }).click()
    await page.getByRole('tab', { name: 'Summary' }).click()
    await page.getByRole('button', { name: 'Generate notes' }).click()
    await expect(
      page.getByRole('heading', { name: 'Send this meeting?' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Keep it local' }).click()
    expect(await page.evaluate(() => typeof window.require)).toBe('undefined')
    expect(await page.evaluate(() => typeof window.process)).toBe('undefined')
    await page.getByRole('searchbox').fill('onboarding')
    await expect(page.locator('.meeting-row')).toHaveCount(1)
    await page.getByRole('searchbox').fill('not-here')
    await expect(page.getByText('No meetings found.')).toBeVisible()
    await app.close()
    app = await electron.launch({ args: [resolve('.')], env })
    page = await app.firstWindow()
    await page.getByRole('button', { name: /Design review/ }).click()
    await expect(
      page.getByRole('textbox', { name: 'Your meeting notes' }),
    ).toHaveValue(
      'Ship the notebook on Friday. Maya owns the onboarding draft.',
    )
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByLabel('Provider', { exact: true })).toHaveValue(
      'openai',
    )
    await page.getByRole('button', { name: 'Close settings' }).click()
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(820, 600)
    })
    await page.screenshot({ path: 'test-results/compact.png' })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
