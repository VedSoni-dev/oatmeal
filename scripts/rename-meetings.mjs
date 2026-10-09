#!/usr/bin/env node
// Backfill: give recordings saved as "<stamp>-meeting.transcript.md" a real
// name, using the same sources as the live recorder (calendar, transcript).
//
//   node scripts/rename-meetings.mjs            (dry run — prints proposals)
//   node scripts/rename-meetings.mjs --apply    (renames files + fixes headings)

import { readFile, writeFile, rename, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { slug, finalTitle } from '../capture/naming.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MEETINGS_DIR = process.env.OATMEAL_MEETINGS_DIR ?? join(__dirname, '..', 'meetings')
const apply = process.argv.includes('--apply')

const files = (await readdir(MEETINGS_DIR)).filter((f) => /^\d{4}-\d{2}-\d{2}-\d{4}-meeting(-\d+)?\.transcript\.md$/.test(f))
for (const f of files) {
  const [, y, mo, d, h, mi] = f.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})/)
  const startedAt = new Date(+y, +mo - 1, +d, +h, +mi)
  const md = await readFile(join(MEETINGS_DIR, f), 'utf8')
  const ended = md.match(/^_Ended (.+?) —/m)?.[1]
  const endedAt = ended && !isNaN(new Date(ended)) ? new Date(ended) : new Date(startedAt.getTime() + 30 * 60000)
  const found = await finalTitle({ startedAt, endedAt, md })
  if (!found) { console.log(`${f}  →  (no name found)`); continue }
  let next = `${f.slice(0, 16)}${slug(found.title)}.transcript.md`
  for (let i = 2; existsSync(join(MEETINGS_DIR, next)); i++) next = `${f.slice(0, 16)}${slug(found.title)}-${i}.transcript.md`
  console.log(`${f}  →  ${next}  (${found.source})`)
  if (apply) {
    await writeFile(join(MEETINGS_DIR, f), md.replace(/^# .*$/m, `# ${found.title} — transcript`))
    await rename(join(MEETINGS_DIR, f), join(MEETINGS_DIR, next))
  }
}
if (!apply && files.length) console.log('\nDry run. Re-run with --apply to rename.')
