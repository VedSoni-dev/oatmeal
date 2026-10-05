// Reproducible documentation media. Only fictional data; no microphone or AI calls.
import { _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { MeetingStore } from '../desktop/core/store.mjs'

const root = resolve('.')
const output = join(root, 'docs/assets')
const profile = await mkdtemp(join(tmpdir(), 'oatmeal-showcase-'))
const frames = join(profile, 'frames')
await mkdir(output, { recursive: true })
await mkdir(frames)
const store = await new MeetingStore(join(profile, 'meetings')).init()
const samples = [
  [
    'Website walkthrough',
    '2026-10-02T15:00:00Z',
    'A simpler home page, with the product front and center.',
  ],
  [
    'Friday planning',
    '2026-10-03T15:00:00Z',
    'Keep the next release small. Make the first five minutes feel easy.',
  ],
  ['Product sync', '2026-10-05T15:00:00Z', ''],
]
let featured
for (const [title, createdAt, notes] of samples) {
  const meeting = await store.create(title)
  await store.update(meeting.id, (m) =>
    Object.assign(m, { createdAt, notes, status: 'complete' }),
  )
  featured = meeting
}
await store.update(featured.id, (m) =>
  Object.assign(m, {
    notes:
      'A calmer first five minutes.\n\n• One clear recording action\n• Explain where the AI runs\n• Keep the first meeting easy to find',
    summary:
      '## A calmer first five minutes\nWe agreed to simplify onboarding and make the first recording easier to find.\n\n## Decisions\n- Keep one clear recording action.\n- Explain local and cloud AI during setup.\n\n## Next steps\n- Maya — draft the welcome copy by Friday.\n- Alex — test microphone permissions on Windows.',
    summaryProvider: 'openai',
    segments: [
      {
        id: 'demo-1',
        offset: 0,
        speaker: 'you',
        text: 'Let’s make the first five minutes feel calmer. One clear recording action, and a short explanation of where the AI runs.',
      },
      {
        id: 'demo-2',
        offset: 18,
        speaker: 'room',
        text: 'Agreed. I’m Maya — I’ll draft the welcome copy by Friday.',
      },
      {
        id: 'demo-3',
        offset: 34,
        speaker: 'you',
        text: 'Perfect. We should also check what happens when microphone permission is denied.',
      },
      {
        id: 'demo-4',
        offset: 46,
        speaker: 'room',
        text: 'Alex here. I’ll test microphone permissions on Windows and share what I find.',
      },
    ],
  }),
)
const env = { ...process.env, OATMEAL_TEST_DATA: profile }
for (const key of [
  'ELECTRON_RUN_AS_NODE',
  'PUBLIK_API_KEY',
  'PUBLIK_APP_TOKEN',
  'PUBLIK_API_BASE_URL',
])
  delete env[key]
const app = await electron.launch({ args: [root], env })
const clips = []
try {
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1180, 800),
  )
  await page.getByRole('button', { name: /Product sync/ }).click()
  await page.locator('#summary-tab').click()
  await page.screenshot({ path: join(output, 'oatmeal-notebook.png') })
  async function frame(name, duration) {
    const path = join(frames, `${name}.png`)
    await page.screenshot({ path })
    clips.push(`file '${path}'\nduration ${duration}`)
  }
  await page.locator('#notes-tab').click()
  await frame('01-notes', 2.5)
  await page.locator('#transcript-tab').click()
  await frame('02-transcript', 3)
  await page.locator('#summary-tab').click()
  await frame('03-summary', 4.5)
  await page.locator('#settings-open').click()
  await page.getByLabel('Provider', { exact: true }).selectOption('local')
  await page.screenshot({ path: join(output, 'oatmeal-settings.png') })
} finally {
  await app.close()
}
const concat = join(frames, 'frames.txt')
await writeFile(
  concat,
  clips.join('\n') + `\nfile '${join(frames, '03-summary.png')}'\n`,
)
const gif = spawnSync(
  'ffmpeg',
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concat,
    '-filter_complex',
    'fps=8,scale=1000:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
    '-t',
    '10',
    '-final_delay',
    '0',
    '-loop',
    '0',
    join(output, 'oatmeal-demo.gif'),
  ],
  { stdio: 'inherit' },
)
if (gif.status !== 0)
  throw new Error('GIF encoding failed. Install ffmpeg to regenerate the demo.')
console.log(
  'Captured actual Oatmeal UI with fictional demo data; no audio or cloud calls.',
)
