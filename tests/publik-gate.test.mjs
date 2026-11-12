// Sign in with publik + usage counting, end to end against a local stand-in for publikhq.com
// (nothing leaves the machine; a stub `open` keeps the real browser shut).
//   node --test tests/
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('the recorder opens only after Sign in with publik, then counts the launch', async (t) => {
  const temp = mkdtempSync(join(tmpdir(), 'oatmeal-publik-'))
  // stub `open` / `xdg-open`: record the URL instead of opening a browser
  for (const name of ['open', 'xdg-open']) {
    const file = join(temp, name)
    writeFileSync(file, `#!/bin/sh\necho "$1" >> "${join(temp, 'opened.txt')}"\n`)
    chmodSync(file, 0o755)
  }

  let claimed = false
  const hits = []
  const publik = createServer(async (req, res) => {
    let body = ''
    for await (const c of req) body += c
    hits.push({ method: req.method, url: req.url, auth: req.headers.authorization ?? null, body: body ? JSON.parse(body) : null })
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/v1/installs') { res.writeHead(201); return res.end(JSON.stringify({ key: 'pk_oatmeal_test', install_id: '33333333-3333-4333-8333-333333333333', claim_url: 'https://publikhq.com/claim/test' })) }
    if (req.url === '/api/v1/wallet') { res.writeHead(200); return res.end(JSON.stringify({ claim_state: claimed ? 'claimed' : 'anonymous', claim_url: 'https://publikhq.com/claim/test', account: claimed ? { handle: 'tester' } : null, plan: { kind: 'none', label: null }, balance_micros: 0, top_up_url: 'https://publikhq.com/wallet', linked_at: null })) }
    if (req.url === '/api/v1/telemetry') { res.writeHead(204); return res.end() }
    res.writeHead(404); res.end('{}')
  })
  await new Promise((r) => publik.listen(0, '127.0.0.1', r))
  const PORT = 4300 + Math.floor(Math.random() * 500)
  const env = { ...process.env, HOME: temp, XDG_CONFIG_HOME: join(temp, '.config'), LOCALAPPDATA: join(temp, 'AppData'), PATH: `${temp}:${process.env.PATH}`,
    PORT: String(PORT), PUBLIK_ORIGIN: `http://127.0.0.1:${publik.address().port}`, PUBLIK_APP_TOKEN: 'pat_oatmeal_test', OATMEAL_MEETINGS_DIR: join(temp, 'meetings') }
  for (const k of ['DO_NOT_TRACK', 'PUBLIK_TELEMETRY', 'PUBLIK_API_KEY', 'PUBLIK_SELF_TEST']) delete env[k]
  const server = spawn(process.execPath, [join(ROOT, 'capture/server.mjs')], { env, stdio: 'ignore' })
  t.after(() => { server.kill(); publik.close(); rmSync(temp, { recursive: true, force: true }) })

  const base = `http://localhost:${PORT}`
  const gateState = async () => (await fetch(`${base}/api/publik/gate`)).json()
  for (let i = 0; i < 50; i++) { try { if ((await gateState()).screen) break } catch {} await sleep(100) }

  // Before sign-in: every page is the gate, and the recorder's API refuses.
  const page = await (await fetch(`${base}/`)).text()
  assert.match(page, /Sign in with publik/)
  assert.match(page, /Oatmeal is free on <a [^>]*>publik<\/a>, a free software marketplace\. When you use it through publik, its builder earns a small share of the usage, which keeps Oatmeal free\. publik's mission: free software for everyone\./)
  assert.match(page, /href="https:\/\/publikhq\.com"[^>]*>Make a free publik account →<\/a>/)
  assert.doesNotMatch(page, /meeting recorder<\/title>/)
  assert.equal((await fetch(`${base}/api/session/start`, { method: 'POST', body: '{}' })).status, 403)
  assert.equal((await fetch(`${base}/api/meetings`)).status, 403)
  let state = await gateState()
  assert.equal(state.ready, false)
  assert.equal(state.screen.title, 'Sign in with publik')
  assert.deepEqual(state.screen.buttons.map((b) => b.label), ['Sign in with publik'])
  assert.equal((await fetch(`${base}/api/publik/gate`, { method: 'POST', body: JSON.stringify({ action: 'retry' }) })).status, 409) // not a button on this screen

  // Sign in with publik: the browser opens the claim page, the note says it is waiting.
  assert.equal((await fetch(`${base}/api/publik/gate`, { method: 'POST', body: JSON.stringify({ action: 'sign_in' }) })).status, 200)
  await sleep(300)
  state = await gateState()
  assert.equal(state.link, 'https://publikhq.com/claim/test')
  assert.equal(state.screen.note, 'Waiting for you to sign in in your browser.')

  // The person signs in in their browser: within one 3-second check the recorder opens by itself.
  claimed = true
  for (let i = 0; i < 60 && !state.ready; i++) { await sleep(100); state = await gateState() }
  assert.equal(state.ready, true)
  assert.match(await (await fetch(`${base}/`)).text(), /meeting recorder<\/title>/)
  assert.equal((await fetch(`${base}/api/meetings`)).status, 200)

  // Usage counting: app_opened with the install key, and no other field than publik's.
  await sleep(300)
  const ping = hits.find((h) => h.url === '/api/v1/telemetry')
  assert.ok(ping, 'app_opened was sent')
  assert.equal(ping.body.event, 'app_opened')
  assert.equal(ping.body.app, 'oatmeal-vedsoni-dev')
  assert.equal(ping.auth, 'Bearer pk_oatmeal_test')
  for (const k of Object.keys(ping.body)) assert.ok(['v', 'app', 'install_id', 'event', 'app_version', 'os', 'arch'].includes(k), k)
})
