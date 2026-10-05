import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, cp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('real Whisper processes a synthetic microphone through the worklet and saves the tail', async () => {
  test.skip(
    !process.env.OATMEAL_SPEECH_FIXTURE || !process.env.OATMEAL_MODEL_CACHE,
    'Opt in with a synthetic WAV fixture and downloaded model cache; never uses the real microphone.',
  )
  test.setTimeout(180_000)
  const profile = await mkdtemp(join(tmpdir(), 'oatmeal-recording-'))
  await cp(process.env.OATMEAL_MODEL_CACHE, join(profile, 'models'), {
    recursive: true,
  })
  const env = { ...process.env, OATMEAL_TEST_DATA: profile }
  delete env.ELECTRON_RUN_AS_NODE
  // Chromium's audio-service sandbox cannot read the synthetic fixture on macOS.
  // The no-sandbox flag is confined to this opt-in fake-device test. The normal
  // desktop test verifies the shipping renderer remains sandboxed.
  const app = await electron.launch({
    args: [
      resolve('.'),
      '--no-sandbox',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${process.env.OATMEAL_SPEECH_FIXTURE}`,
    ],
    env,
  })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Start a meeting' }).click()
    await page.getByRole('checkbox', { name: 'Meeting audio' }).uncheck()
    await page.getByRole('button', { name: 'Record', exact: false }).click()
    await expect(page.locator('#record')).toHaveText('■ Stop', {
      timeout: 90_000,
    })
    await expect(page.locator('#timer')).toHaveText('00:07', {
      timeout: 20_000,
    })
    await page.locator('#record').click()
    await expect(page.locator('#record')).toHaveText('● Record', {
      timeout: 90_000,
    })
    await page.getByRole('tab', { name: 'Transcript' }).click()
    await expect(page.locator('#transcript')).toContainText(
      /design review|Friday|onboarding/i,
    )
    expect(await readdir(join(profile, 'pending-audio'))).toEqual([])
    await page.screenshot({ path: 'test-results/real-transcript.png' })
  } finally {
    await app.close()
  }
})
