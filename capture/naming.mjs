// Meeting naming — picks a real title for a recording instead of "meeting".
// Tried in order, first hit wins:
//   1. the title you typed in the recorder
//   2. the calendar event overlapping the recording (ICS feed in oatmeal.config.json)
//   3. the shared browser tab's title (e.g. "Weekly sync - Zoom"), if it isn't generic
//   4. a short title written by the `claude` CLI from the transcript (local agent, no API key)
// If none of these work the file stays "<stamp>-meeting" — better than a wrong name.
// Zero external deps. Every source fails soft.

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const CONFIG_PATH = join(ROOT, 'oatmeal.config.json')

export const GENERIC = /^(meeting|untitled|new tab|entire screen|screen[\s:\d]*|window[\s:\d]*|about:blank)$/i

export function slug(s) {
  return (s || 'meeting').toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60).replace(/-+$/, '') || 'meeting'
}

async function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return {}
  try { return JSON.parse(await readFile(CONFIG_PATH, 'utf8')) } catch { return {} }
}

// --- 2. calendar ---------------------------------------------------------

// Minimal ICS parser: SUMMARY / DTSTART / DTEND per VEVENT (unfolds long lines).
export function parseIcs(text) {
  const events = []
  const unfolded = text.replace(/\r?\n[ \t]/g, '')
  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0]
    const get = (key) => body.match(new RegExp(`^${key}([^:]*):(.*)$`, 'm'))
    const summary = get('SUMMARY')?.[2]?.trim().replace(/\\([,;\\])/g, '$1')
    const start = parseIcsDate(get('DTSTART'))
    const end = parseIcsDate(get('DTEND')) ?? (start && new Date(start.getTime() + 30 * 60000))
    if (summary && start) events.push({ summary, start, end })
  }
  return events
}

function parseIcsDate(m) {
  if (!m) return null
  const [, params, raw] = m
  const d = raw.trim().match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/)
  if (!d) return null // all-day events can't be the meeting
  const [, y, mo, da, h, mi, s, z] = d
  if (z) return new Date(`${y}-${mo}-${da}T${h}:${mi}:${s}Z`)
  // TZID=... times: treat as machine-local (right for your own calendar).
  void params
  return new Date(+y, +mo - 1, +da, +h, +mi, +s)
}

// Best event for a recording window: the one with the most overlap. The
// recording must start during the event or at most 15 minutes before it — a
// recording that merely runs long into the next event isn't that event.
export function pickEvent(events, startedAt, endedAt) {
  const slack = 10 * 60000
  const s = startedAt.getTime(), e = Math.max(endedAt.getTime(), s + 60000)
  let best = null, bestScore = 0
  for (const ev of events) {
    if (s < ev.start.getTime() - 15 * 60000 || s >= ev.end.getTime()) continue
    const es = ev.start.getTime() - slack, ee = ev.end.getTime() + slack
    const overlap = Math.min(e, ee) - Math.max(s, es)
    // Prefer overlap, tie-break on how close the start times are.
    const score = overlap > 0 ? overlap - Math.abs(ev.start.getTime() - s) / 10 : 0
    if (score > bestScore) { best = ev; bestScore = score }
  }
  return best
}

let icsCache = { at: 0, events: [] }
export async function calendarTitle(startedAt, endedAt) {
  const { icsUrl } = await loadConfig()
  if (!icsUrl || icsUrl.includes('YOUR_EMAIL')) return null
  try {
    if (Date.now() - icsCache.at > 5 * 60000) {
      const res = await fetch(icsUrl, { signal: AbortSignal.timeout(10000) })
      icsCache = { at: Date.now(), events: parseIcs(await res.text()) }
    }
    return pickEvent(icsCache.events, startedAt, endedAt)?.summary ?? null
  } catch (e) {
    console.error('[naming] calendar fetch failed:', e.message)
    return null
  }
}

// --- 3. tab title --------------------------------------------------------

export function tabTitle(label) {
  if (!label) return null
  const t = label
    .replace(/^meet\s*[-–—]\s*[a-z]{3}-[a-z]{4}-[a-z]{3}$/i, '') // bare Meet code, no info
    .replace(/\s*[-–—|]\s*(zoom|google meet|meet|microsoft teams|teams|webex|google chrome)\s*$/i, '')
    .replace(/^(zoom meeting|zoom workplace|meeting)$/i, '')
    .trim()
  return t && !GENERIC.test(t) ? t : null
}

// --- 4. agent-written title ---------------------------------------------

function findClaude() {
  const candidates = [process.env.OATMEAL_CLAUDE_BIN, join(homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']
  return candidates.find((p) => p && existsSync(p)) ?? null
}

function transcriptText(md) {
  return md
    .split('\n')
    .filter((l) => /^\*\*(You|Room):\*\*/.test(l))
    .map((l) => l.replace(/^\*\*(You|Room):\*\*\s*/, ''))
    .filter((l) => l.split(/\s+/).length > 2) // drop Whisper filler like "you."
    .join('\n')
}

export async function agentTitle(md) {
  const bin = findClaude()
  const text = transcriptText(md)
  if (!bin || text.length < 200) return null
  // Sample beginning, middle and end so long meetings are represented.
  const n = 6000
  const sample = text.length <= n * 3 ? text : [text.slice(0, n), text.slice(text.length / 2 - n / 2, text.length / 2 + n / 2), text.slice(-n)].join('\n…\n')
  const prompt =
    'Below is an auto-transcribed meeting (may contain transcription errors). ' +
    'Reply with ONLY a short, specific title for it, 3-7 words, no quotes or punctuation at the end. ' +
    'Prefer the counterpart person/organization and topic, e.g. "Acme pilot pricing with Dana Lee".'
  return new Promise((resolve) => {
    const child = execFile(bin, ['-p', '--model', 'haiku', prompt], { timeout: 90000, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err) { console.error('[naming] claude title failed:', (stdout || err.message).trim().slice(0, 200)); return resolve(null) }
      const t = stdout.trim().split('\n').pop().replace(/^["'#*\s]+|["'.*\s]+$/g, '')
      resolve(t && t.length <= 80 && !GENERIC.test(t) && !/fail|error|expired/i.test(t) ? t : null)
    })
    child.stdin.end(sample)
  })
}

// --- orchestration -------------------------------------------------------

// Fast sources only — used when a session starts so the file is named right away.
export async function quickTitle({ typed, startedAt, tab }) {
  if (typed && typed.trim() && !GENERIC.test(typed.trim())) return { title: typed.trim(), source: 'typed' }
  const cal = await calendarTitle(startedAt, startedAt)
  if (cal) return { title: cal, source: 'calendar' }
  const t = tabTitle(tab)
  if (t) return { title: t, source: 'tab' }
  return null
}

// Everything, including transcript analysis — used when a session stops.
export async function finalTitle({ startedAt, endedAt, tab, md }) {
  const cal = await calendarTitle(startedAt, endedAt)
  if (cal) return { title: cal, source: 'calendar' }
  const t = tabTitle(tab)
  if (t) return { title: t, source: 'tab' }
  const a = await agentTitle(md)
  if (a) return { title: a, source: 'agent' }
  return null // leave "meeting" rather than guess a misleading name
}
