// The page the recorder shows until Sign in with publik is done (capture/publik.mjs runs the gate on the
// server; this page draws its screens and sends the button presses back). It reloads into the recorder
// as soon as the gate opens.
export function gatePage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>🥣 Oatmeal — Sign in with publik</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🥣</text></svg>" />
  <style>
    :root { color-scheme: light dark; --bg: #f5eedd; --panel: #fdf8ec; --ink: #2c1e10; --ink-soft: #5c4326; --line: #d9c7a3; --accent: #b4551f; --muted: #9a8360;
      --serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif; }
    @media (prefers-color-scheme: dark) { :root { --bg: #191310; --panel: #211a13; --ink: #eadfc6; --ink-soft: #c9b48d; --line: #3b2c1c; --accent: #e07a3c; --muted: #8d7a5e; } }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 1.25rem; background: var(--bg); color: var(--ink); font-family: var(--serif); line-height: 1.5; }
    main { width: 100%; max-width: 30rem; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 2rem 1.75rem; }
    .brand { color: var(--muted); font-size: .85rem; letter-spacing: .06em; text-transform: uppercase; }
    h1 { font-size: 1.6rem; margin: .25rem 0 .75rem; font-weight: 600; }
    p { margin: 0 0 .75rem; color: var(--ink-soft); }
    #note { font-size: .95rem; color: var(--muted); }
    .row { display: flex; flex-wrap: wrap; gap: .6rem; margin-top: 1.25rem; }
    button { font: inherit; font-weight: 600; padding: .6rem 1.1rem; border-radius: 10px; border: 1px solid var(--line); background: transparent; color: var(--ink); cursor: pointer; }
    button.primary { background: var(--accent); border-color: var(--accent); color: #fff8ee; }
    button:disabled { opacity: .6; cursor: default; }
    #link { word-break: break-all; font-size: .9rem; }
    .pitch { margin-top: 1.5rem; padding-top: 1.1rem; border-top: 1px solid var(--line); font-size: .95rem; }
    .pitch p { margin: 0 0 .5rem; }
    .pitch .cta { font-weight: 600; }
    a { color: var(--accent); }
  </style>
</head>
<body>
  <main aria-live="polite">
    <div class="brand">🥣 Oatmeal</div>
    <h1 id="title">Sign in with publik</h1>
    <p id="body">Starting…</p>
    <p id="note" hidden></p>
    <div class="row" id="buttons"></div>
    <p id="link" hidden></p>
    <div class="pitch">
      <p>Oatmeal is free on <a href="https://publikhq.com" target="_blank" rel="noopener">publik</a>, a free software marketplace. When you use it through publik, its builder earns a small share of the usage, which keeps Oatmeal free. publik's mission: free software for everyone.</p>
      <a class="cta" href="https://publikhq.com" target="_blank" rel="noopener">Make a free publik account →</a>
    </div>
  </main>
  <script>
    const $ = (id) => document.getElementById(id)
    let shown = ''
    async function press(action, button) {
      button.disabled = true
      try { await fetch('/api/publik/gate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) }) } catch {}
      refresh()
    }
    function draw(state) {
      const s = state.screen
      const key = JSON.stringify([s, state.link])
      if (key === shown) return
      shown = key
      if (!s) { $('body').textContent = 'Starting…'; $('buttons').replaceChildren(); return }
      $('title').textContent = s.title
      $('body').textContent = s.body
      $('note').hidden = !s.note
      $('note').textContent = s.note || ''
      $('buttons').replaceChildren(...s.buttons.map((b, i) => {
        const el = document.createElement('button')
        el.textContent = b.label
        if (i === 0) el.className = 'primary'
        el.onclick = () => press(b.action, el)
        return el
      }))
      $('link').hidden = !state.link
      if (state.link) {
        const a = document.createElement('a')
        a.href = state.link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = state.link
        $('link').replaceChildren('If your browser did not open, open this link: ', a)
      }
    }
    async function refresh() {
      try {
        const state = await (await fetch('/api/publik/gate', { cache: 'no-store' })).json()
        if (state.ready) return location.reload()
        draw(state)
      } catch { draw({ screen: { title: 'Sign in with publik', body: 'The Oatmeal server is not running. Start it with npm start.', note: null, buttons: [] } }) }
    }
    refresh()
    setInterval(refresh, 1500)
  </script>
</body>
</html>`
}
