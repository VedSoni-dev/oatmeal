// Oatmeal recorder: mic + system audio -> local Whisper -> transcript segments
// POSTed to the capture server, which appends them to a markdown file your
// coding agent reads. All processing is local.

const btn = document.getElementById('btn')
const titleInput = document.getElementById('title')
const statusEl = document.getElementById('status')
const transcriptEl = document.getElementById('transcript')

const CHUNK_SECONDS = 5
const MODEL_ID = 'Xenova/whisper-base'
const SILENCE = /^[\s]*[[(][^)\]]*[)\]][\s]*$/

let recording = false
let session = null
let ctx, processor, mixer, streams = []
let asr = null
let buffers = [], buffered = 0
let pump = Promise.resolve()

function status(msg) { statusEl.textContent = msg }

function addSegment(text, interim = false) {
  if (interim) {
    let el = document.getElementById('interim')
    if (!text) { el?.remove(); return }
    if (!el) {
      el = document.createElement('p')
      el.id = 'interim'
      el.className = 'seg interim'
      transcriptEl.appendChild(el)
    }
    el.textContent = text
  } else {
    document.getElementById('interim')?.remove()
    const p = document.createElement('p')
    p.className = 'seg'
    p.textContent = text
    transcriptEl.appendChild(p)
  }
  transcriptEl.scrollTop = transcriptEl.scrollHeight
}

async function loadWhisper() {
  if (asr) return asr
  const { pipeline, env } = await import('/vendor/transformers/transformers.min.js')
  env.allowLocalModels = false
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = 1
    env.backends.onnx.wasm.wasmPaths = new URL('/vendor/transformers/', location.href).href
  }
  const device = 'gpu' in navigator ? 'webgpu' : 'wasm'
  const make = (dev) =>
    pipeline('automatic-speech-recognition', MODEL_ID, {
      device: dev,
      progress_callback: (p) => {
        if (p.status === 'progress' && typeof p.progress === 'number') {
          status(`Downloading Whisper model… ${Math.round(p.progress)}%`)
        }
      }
    })
  try {
    asr = await make(device)
  } catch (e) {
    if (device === 'webgpu') { status('WebGPU failed, falling back to WASM…'); asr = await make('wasm') }
    else throw e
  }
  return asr
}

async function startCapture() {
  ctx = new AudioContext({ sampleRate: 16000 })
  await ctx.resume()
  mixer = ctx.createGain()

  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  })
  streams.push(mic)
  ctx.createMediaStreamSource(mic).connect(mixer)

  let sysActive = false
  try {
    // Chrome: share a screen/tab WITH audio -> we get system loopback. Video is
    // required by the API; we stop the track immediately.
    const sys = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false },
      systemAudio: 'include',
      selfBrowserSurface: 'exclude'
    })
    sys.getVideoTracks().forEach((t) => t.stop())
    if (sys.getAudioTracks().length > 0) {
      streams.push(sys)
      ctx.createMediaStreamSource(sys).connect(mixer)
      sysActive = true
    }
  } catch { /* mic-only fallback */ }

  processor = ctx.createScriptProcessor(4096, 1, 1)
  mixer.connect(processor)
  const silent = ctx.createGain()
  silent.gain.value = 0
  processor.connect(silent)
  silent.connect(ctx.destination)

  processor.onaudioprocess = (e) => {
    if (!recording) return
    const input = e.inputBuffer.getChannelData(0)
    buffers.push(new Float32Array(input))
    buffered += input.length
    if (buffered >= ctx.sampleRate * CHUNK_SECONDS) schedule(processReady)
  }
  return sysActive
}

function takeWindow(size) {
  const out = new Float32Array(size)
  let filled = 0
  while (filled < size && buffers.length > 0) {
    const head = buffers[0]
    const need = size - filled
    if (head.length <= need) { out.set(head, filled); filled += head.length; buffers.shift() }
    else { out.set(head.subarray(0, need), filled); buffers[0] = head.subarray(need); filled += need }
  }
  buffered -= size
  return out
}

function schedule(task) { pump = pump.then(task).catch((e) => console.error('[whisper]', e)) }

async function transcribeChunk(audio) {
  try {
    const result = await asr(audio)
    const text = (Array.isArray(result) ? result[0]?.text : result?.text ?? '').trim()
    if (text && !SILENCE.test(text) && session) {
      addSegment(text)
      await fetch('/api/session/segment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: session.id, text })
      }).catch(() => {})
    }
  } catch (e) {
    console.error('[whisper] chunk failed:', e)
    status('⚠️ Transcription error: ' + (e?.message ?? e))
  }
}

async function processReady() {
  const chunk = ctx.sampleRate * CHUNK_SECONDS
  while (buffered >= chunk && recording) {
    await transcribeChunk(takeWindow(chunk))
  }
}

// On stop: transcribe everything still buffered (full chunks + any tail >= 1s)
// so short recordings and last words are never lost.
async function drainFinal() {
  const rate = ctx?.sampleRate ?? 16000
  const chunk = rate * CHUNK_SECONDS
  while (buffered >= chunk) await transcribeChunk(takeWindow(chunk))
  if (buffered >= rate) await transcribeChunk(takeWindow(buffered))
  buffers = []; buffered = 0
}

async function start() {
  btn.disabled = true
  try {
    status('Loading Whisper…')
    await loadWhisper()
    status('In the picker: choose "Entire screen" AND check "share system audio" (or the meeting tab + "share tab audio"). Window shares have NO audio.')
    const sysActive = await startCapture()
    const res = await fetch('/api/session/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: titleInput.value })
    })
    session = await res.json()
    recording = true
    btn.textContent = '■ Stop'
    btn.className = 'stop'
    status(
      sysActive
        ? `Recording (mic + system audio ✓) → ${session.file.split(/[\\/]/).pop()}`
        : `⚠️ Recording MIC ONLY — no system audio captured! The other side of your meeting will be missed. Stop and re-record sharing "Entire screen" with "share system audio" checked.`
    )
  } catch (e) {
    status('⚠️ ' + (e?.message ?? e))
  } finally {
    btn.disabled = false
  }
}

async function stop() {
  recording = false
  btn.disabled = true
  // Stop capturing new audio immediately…
  processor?.disconnect(); mixer?.disconnect()
  streams.forEach((s) => s.getTracks().forEach((t) => t.stop()))
  streams = []
  // …but transcribe what's already buffered before closing the session.
  if (buffered > 0) status('Finishing transcription…')
  schedule(drainFinal)
  await pump
  ctx?.close()
  btn.textContent = '● Record'
  btn.className = ''
  btn.disabled = false
  if (session) {
    const res = await fetch('/api/session/stop', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: session.id })
    })
    const data = await res.json()
    session = null
    status(
      data.segments > 0
        ? `Saved ${data.segments} segments. Ask your coding agent: "write up my meeting" — it reads ${String(data.file).split(/[\\/]/).pop()}`
        : '⚠️ 0 segments captured. Was anything audible? For meeting audio you MUST share "Entire screen" (+ check "share system audio") or the meeting tab (+ "also share tab audio") — a window share has no audio.'
    )
  } else {
    status('Stopped.')
  }
}

async function loadMeetings() {
  const el = document.getElementById('meetings')
  try {
    const { files } = await (await fetch('/api/meetings')).json()
    el.innerHTML = files.length
      ? files.slice(0, 8).map((f) => `<span class="meeting">${f}</span>`).join('')
      : '<span class="muted">No meetings yet — your first transcript will appear here.</span>'
  } catch {
    el.innerHTML = '<span class="muted">Could not load meetings.</span>'
  }
}
loadMeetings()

btn.addEventListener('click', async () => {
  if (recording) { await stop(); loadMeetings() } else start()
})
