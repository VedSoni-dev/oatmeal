#!/usr/bin/env node
// Oatmeal capture server — tiny local server, zero external deps.
// Serves the recorder UI, receives transcript segments, writes markdown files
// your coding agent reads. Nothing leaves your machine.
//
//   node capture/server.mjs        (default port 4123)
//
// Files land in meetings/ at the repo root:
//   meetings/2026-07-18-1432-standup.transcript.md   (live, appended during meeting)

import { createServer } from 'node:http'
import { readFile, writeFile, appendFile, mkdir, readdir, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { slug, quickTitle, finalTitle } from './naming.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
// Point at a team knowledge repo's meetings folder with OATMEAL_MEETINGS_DIR.
const MEETINGS_DIR = process.env.OATMEAL_MEETINGS_DIR ?? join(ROOT, 'meetings')
const PORT = Number(process.env.PORT ?? 4123)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json'
}

// Static roots: the UI, plus transformers.js + onnx runtime from node_modules so
// Whisper runs fully local (no CDN).
const STATIC = [
  { prefix: '/vendor/transformers/', dir: join(ROOT, 'node_modules/@huggingface/transformers/dist') },
  { prefix: '/', dir: join(__dirname, 'public') }
]

const sessions = new Map() // id -> { file, title, startedAt, segments: number }

// meetings/<stamp>-<slug>.transcript.md, adding -2, -3… if that name is taken.
function transcriptPath(startedAt, title, current) {
  const base = `${stamp(startedAt)}-${slug(title)}`
  for (let i = 1; ; i++) {
    const file = join(MEETINGS_DIR, `${base}${i > 1 ? `-${i}` : ''}.transcript.md`)
    if (file === current || !existsSync(file)) return file
  }
}

// Give a finished session a real name: rename the file and fix its heading.
async function nameSession(s, endedAt) {
  if (s.titleSource === 'typed' || s.titleSource === 'calendar') return
  const md = await readFile(s.file, 'utf8')
  const found = await finalTitle({ startedAt: s.startedAt, endedAt, tab: s.tab, md })
  if (!found || found.title === s.title) return
  const file = transcriptPath(s.startedAt, found.title, s.file)
  await writeFile(s.file, md.replace(/^# .*$/m, `# ${found.title} — transcript`))
  if (file !== s.file) await rename(s.file, file)
  console.log(`[oatmeal] named ${file.split('/').pop()} (from ${found.source})`)
  Object.assign(s, { file, title: found.title, titleSource: found.source })
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

async function json(req) {
  let body = ''
  for await (const chunk of req) body += chunk
  return body ? JSON.parse(body) : {}
}

function send(res, code, data, type = 'application/json') {
  const payload = type === 'application/json' ? JSON.stringify(data) : data
  res.writeHead(code, { 'content-type': type, 'access-control-allow-origin': '*' })
  res.end(payload)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const path = url.pathname

  try {
    // --- API ---
    if (req.method === 'POST' && path === '/api/session/start') {
      const { title: typed, tab } = await json(req)
      const now = new Date()
      const id = `${Date.now()}`
      // Name it now if we can (typed title, calendar, tab); otherwise it gets
      // a real name from the transcript when the session stops.
      const quick = await quickTitle({ typed, startedAt: now, tab })
      const title = quick?.title ?? 'Meeting'
      await mkdir(MEETINGS_DIR, { recursive: true })
      const file = transcriptPath(now, title)
      await writeFile(file, `# ${title} — transcript\n\n_Started ${now.toLocaleString()}_\n\n`)
      sessions.set(id, { file, title, titleSource: quick?.source ?? null, tab, startedAt: now, segments: 0 })
      return send(res, 200, { id, file, title })
    }

    if (req.method === 'POST' && path === '/api/session/segment') {
      const { id, text, speaker } = await json(req)
      const s = sessions.get(id)
      if (!s) return send(res, 404, { error: 'unknown session' })
      if (text && text.trim()) {
        // speaker attribution: "you" (mic) vs "room" (system audio) are captured
        // as separate tracks and transcribed separately — not full multi-person
        // diarization, but correctly separates what you said from what the
        // meeting said.
        const label = speaker === 'you' ? '**You:** ' : speaker === 'room' ? '**Room:** ' : ''
        await appendFile(s.file, label + text.trim() + '\n\n')
        s.segments++
      }
      return send(res, 200, { ok: true, segments: s.segments })
    }

    if (req.method === 'POST' && path === '/api/session/stop') {
      const { id } = await json(req)
      const s = sessions.get(id)
      if (!s) return send(res, 404, { error: 'unknown session' })
      const endedAt = new Date()
      await appendFile(s.file, `\n_Ended ${endedAt.toLocaleString()} — ${s.segments} segments_\n`)
      sessions.delete(id)
      try { await nameSession(s, endedAt) } catch (e) { console.error('[oatmeal] naming failed:', e.message) }
      return send(res, 200, { ok: true, file: s.file, title: s.title, segments: s.segments })
    }

    if (req.method === 'GET' && path === '/api/meetings') {
      await mkdir(MEETINGS_DIR, { recursive: true })
      const files = (await readdir(MEETINGS_DIR)).filter((f) => f.endsWith('.md')).sort().reverse()
      return send(res, 200, { files })
    }

    if (req.method === 'GET' && path === '/api/meeting') {
      // basename-only: no path traversal out of the meetings dir
      const name = (url.searchParams.get('file') ?? '').replace(/[\\/]/g, '')
      const file = join(MEETINGS_DIR, name)
      if (!name.endsWith('.md') || !existsSync(file)) return send(res, 404, { error: 'not found' })
      return send(res, 200, { file: name, content: await readFile(file, 'utf8') })
    }

    if (req.method === 'GET' && path === '/api/health') {
      return send(res, 200, { ok: true, meetingsDir: MEETINGS_DIR })
    }

    // --- static ---
    if (req.method === 'GET') {
      for (const { prefix, dir } of STATIC) {
        if (path.startsWith(prefix)) {
          let rel = path.slice(prefix.length)
          if (rel === '' || rel === '/') rel = 'index.html'
          const file = normalize(join(dir, rel))
          if (!file.startsWith(normalize(dir))) return send(res, 403, { error: 'forbidden' })
          if (!existsSync(file)) continue
          const data = await readFile(file)
          res.writeHead(200, {
            'content-type': MIME[extname(file)] ?? 'application/octet-stream',
            'cross-origin-opener-policy': 'same-origin',
            'cross-origin-embedder-policy': 'credentialless'
          })
          return res.end(data)
        }
      }
      return send(res, 404, { error: 'not found' })
    }

    send(res, 405, { error: 'method not allowed' })
  } catch (e) {
    send(res, 500, { error: String(e?.message ?? e) })
  }
})

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`[oatmeal] already running on http://localhost:${PORT} — nothing to do.`)
    process.exit(0)
  }
  throw e
})

server.listen(PORT, () => {
  console.log(`[oatmeal] capture server on http://localhost:${PORT}`)
  console.log(`[oatmeal] transcripts land in ${MEETINGS_DIR}`)
})
