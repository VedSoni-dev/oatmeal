#!/usr/bin/env node
// Standalone calendar watcher — no coding agent required to keep running.
// Polls a calendar's ICS feed (Google Calendar: Settings > your calendar >
// "Secret address in iCal format" — no OAuth needed) and opens the recorder
// in your browser a few minutes before each meeting starts.
//
// Setup once:
//   cp oatmeal.config.example.json oatmeal.config.json
//   # paste your ICS URL into it
//   node scripts/install-autostart.mjs --calendar    (runs this forever in background)
//
// Or run directly to test: node scripts/calendar-watch.mjs

import { exec } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { platform } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const CONFIG_PATH = join(ROOT, 'oatmeal.config.json')
const NOTIFIED_PATH = join(ROOT, '.oatmeal-notified.json')
const POLL_MS = 5 * 60 * 1000
const RECORDER_URL = process.env.OATMEAL_URL ?? 'http://localhost:4123'

async function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    console.error(
      `[calendar] No oatmeal.config.json found. Copy oatmeal.config.example.json, add your ICS calendar URL, and re-run.`
    )
    return null
  }
  return JSON.parse(await readFile(CONFIG_PATH, 'utf8'))
}

async function loadNotified() {
  if (!existsSync(NOTIFIED_PATH)) return {}
  try {
    return JSON.parse(await readFile(NOTIFIED_PATH, 'utf8'))
  } catch {
    return {}
  }
}

async function saveNotified(map) {
  await writeFile(NOTIFIED_PATH, JSON.stringify(map))
}

// Minimal ICS parser: pulls UID / SUMMARY / DTSTART out of each VEVENT block.
// No external dependency — good enough for standard Google/Outlook feeds.
function parseIcs(text) {
  const events = []
  const blocks = text.split('BEGIN:VEVENT').slice(1)
  for (const block of blocks) {
    const body = block.split('END:VEVENT')[0]
    const get = (key) => {
      const m = body.match(new RegExp(`^${key}[^:]*:(.*)$`, 'm'))
      return m ? m[1].trim() : null
    }
    const uid = get('UID')
    const summary = get('SUMMARY') ?? 'Meeting'
    const dtstart = get('DTSTART')
    if (!uid || !dtstart) continue
    const start = parseIcsDate(dtstart)
    if (start) events.push({ uid, summary, start })
  }
  return events
}

function parseIcsDate(raw) {
  // Handles YYYYMMDDTHHMMSSZ and YYYYMMDDTHHMMSS (local). Skips all-day (date-only).
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/)
  if (!m) return null
  const [, y, mo, d, h, mi, s, z] = m
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${z ? 'Z' : ''}`
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

function openBrowser(url) {
  const cmd =
    platform() === 'win32' ? `start "" "${url}"` : platform() === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`
  exec(cmd, () => {})
}

async function tick() {
  const config = await loadConfig()
  if (!config?.icsUrl) return
  const minutesBefore = config.minutesBeforeMeeting ?? 7

  let text
  try {
    const res = await fetch(config.icsUrl)
    text = await res.text()
  } catch (e) {
    console.error('[calendar] fetch failed:', e.message)
    return
  }

  const events = parseIcs(text)
  const now = Date.now()
  const notified = await loadNotified()
  let changed = false

  for (const ev of events) {
    const msUntil = ev.start.getTime() - now
    const withinWindow = msUntil > 0 && msUntil <= minutesBefore * 60 * 1000
    if (withinWindow && !notified[ev.uid]) {
      console.log(`[calendar] "${ev.summary}" starts in ${Math.round(msUntil / 60000)}m — opening recorder.`)
      openBrowser(RECORDER_URL)
      notified[ev.uid] = now
      changed = true
    }
  }

  // Forget notifications older than a day so recurring events fire again.
  for (const [uid, ts] of Object.entries(notified)) {
    if (now - ts > 24 * 60 * 60 * 1000) { delete notified[uid]; changed = true }
  }
  if (changed) await saveNotified(notified)
}

console.log(`[calendar] watching for meetings, checking every ${POLL_MS / 60000}m`)
tick()
setInterval(tick, POLL_MS)
