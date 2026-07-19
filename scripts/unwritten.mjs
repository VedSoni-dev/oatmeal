#!/usr/bin/env node
// SessionStart hook helper: if any meeting transcript has no matching notes
// file, tell the agent — so it proactively offers a write-up the moment you
// open Claude Code after a meeting. Prints nothing when everything's written
// up (no noise). Zero dependencies, must stay fast.

import { readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MEETINGS_DIR = process.env.OATMEAL_MEETINGS_DIR ?? join(__dirname, '..', 'meetings')

try {
  if (!existsSync(MEETINGS_DIR)) process.exit(0)
  const files = await readdir(MEETINGS_DIR)
  const unwritten = files
    .filter((f) => f.endsWith('.transcript.md'))
    .filter((f) => !files.includes(f.replace(/\.transcript\.md$/, '.notes.md')))
    .sort()
    .reverse()
  if (unwritten.length === 0) process.exit(0)
  console.log(
    `[oatmeal] ${unwritten.length} meeting transcript(s) have no notes yet: ` +
      unwritten.slice(0, 5).join(', ') +
      (unwritten.length > 5 ? ', …' : '') +
      '. Briefly offer to write them up (SKILL.md section 2 / the /writeup command). Mention it once, don\'t nag.'
  )
} catch {
  process.exit(0)
}
