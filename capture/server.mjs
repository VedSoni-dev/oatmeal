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
import { readFile, writeFile, appendFile, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const MEETINGS_DIR = join(ROOT, 'meetings')
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

function slug(s) {
  return (s || 'meeting').toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 50) || 'meeting'
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
      const { title } = await json(req)
      const now = new Date()
      const id = `${Date.now()}`
      const file = join(MEETINGS_DIR, `${stamp(now)}-${slug(title)}.transcript.md`)
      await mkdir(MEETINGS_DIR, { recursive: true })
      await writeFile(
        file,
        `# ${title || 'Meeting'} — transcript\n\n_Started ${now.toLocaleString()}_\n\n`
      )
      sessions.set(id, { file, title: title || 'Meeting', startedAt: now, segments: 0 })
      return send(res, 200, { id, file })
    }

    if (req.method === 'POST' && path === '/api/session/segment') {
      const { id, text } = await json(req)
      const s = sessions.get(id)
      if (!s) return send(res, 404, { error: 'unknown session' })
      if (text && text.trim()) {
        await appendFile(s.file, text.trim() + '\n\n')
        s.segments++
      }
      return send(res, 200, { ok: true, segments: s.segments })
    }

    if (req.method === 'POST' && path === '/api/session/stop') {
      const { id } = await json(req)
      const s = sessions.get(id)
      if (!s) return send(res, 404, { error: 'unknown session' })
      await appendFile(s.file, `\n_Ended ${new Date().toLocaleString()} — ${s.segments} segments_\n`)
      sessions.delete(id)
      return send(res, 200, { ok: true, file: s.file, segments: s.segments })
    }

    if (req.method === 'GET' && path === '/api/meetings') {
      await mkdir(MEETINGS_DIR, { recursive: true })
      const files = (await readdir(MEETINGS_DIR)).filter((f) => f.endsWith('.md')).sort().reverse()
      return send(res, 200, { files })
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

server.listen(PORT, () => {
  console.log(`[oatmeal] capture server on http://localhost:${PORT}`)
  console.log(`[oatmeal] transcripts land in ${MEETINGS_DIR}`)
})
