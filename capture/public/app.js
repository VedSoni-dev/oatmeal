// Oatmeal recorder: mic + system audio -> local Whisper -> transcript segments
// POSTed to the capture server, which appends them to a markdown file your
// coding agent reads. All processing is local.
//
// Speaker attribution: mic and system audio are captured as SEPARATE streams
// (not mixed), each transcribed independently and tagged "You" / "Room". This
// is not full multi-person diarization (can't tell apart two people on the
// other end) but correctly separates what you said from what the meeting said
// — real, useful, no extra dependencies.

const btn = document.getElementById('btn')
const titleInput = document.getElementById('title')
const modelSelect = document.getElementById('model')
const statusEl = document.getElementById('status')
const transcriptEl = document.getElementById('transcript')
const timerEl = document.getElementById('timer')

const CHUNK_SECONDS = 5
const SILENCE = /^[\s]*[[(][^)\]]*[)\]][\s]*$/

let recording = false
let session = null
let ctx, streams = []
let asr = null, asrModel = null
let pump = Promise.resolve()
let timerInterval = null, startedAt = 0

// Whisper model choice persists across visits; changing it reloads on next record.
modelSelect.value = localStorage.getItem('oatmeal-model') ?? 'Xenova/whisper-base'
modelSelect.addEventListener('change', () => localStorage.setItem('oatmeal-model', modelSelect.value))

// Two independent capture lanes, each with its own buffer + processor node.
const lanes = {
  you: { processor: null, source: null, buffers: [], buffered: 0, active: false },
  room: { processor: null, source: null, buffers: [], buffered: 0, active: false }
}

function status(msg) { statusEl.textContent = msg }

function startTimer() {
  startedAt = Date.now()
  timerEl.style.display = 'inline'
  timerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - startedAt) / 1000)
    timerEl.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  }, 500)
}

function stopTimer() {
  clearInterval(timerInterval)
  timerEl.style.display = 'none'
  timerEl.textContent = '00:00'
}

function addSegment(text, speaker, interim = false) {
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
    const tag = document.createElement('b')
    tag.textContent = (speaker === 'you' ? 'You: ' : 'Room: ')
    p.appendChild(tag)
    p.appendChild(document.createTextNode(text))
    transcriptEl.appendChild(p)
  }
  transcriptEl.scrollTop = transcriptEl.scrollHeight
}

async function loadWhisper() {
  const want = modelSelect.value
  if (asr && asrModel === want) return asr
  asr = null
  const { pipeline, env } = await import('/vendor/transformers/transformers.min.js')
  env.allowLocalModels = false
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = 1
    env.backends.onnx.wasm.wasmPaths = new URL('/vendor/transformers/', location.href).href
  }
  const device = 'gpu' in navigator ? 'webgpu' : 'wasm'
  const make = (dev) =>
    pipeline('automatic-speech-recognition', want, {
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
  asrModel = want
  return asr
}

function attachLane(laneKey, mediaStream) {
  const lane = lanes[laneKey]
  lane.source = ctx.createMediaStreamSource(mediaStream)
  lane.processor = ctx.createScriptProcessor(4096, 1, 1)
  lane.source.connect(lane.processor)
  const silent = ctx.createGain()
  silent.gain.value = 0
  lane.processor.connect(silent)
  silent.connect(ctx.destination)
  lane.active = true

  lane.processor.onaudioprocess = (e) => {
    if (!recording) return
    const input = e.inputBuffer.getChannelData(0)
    lane.buffers.push(new Float32Array(input))
    lane.buffered += input.length
    if (lane.buffered >= ctx.sampleRate * CHUNK_SECONDS) schedule(() => processLane(laneKey))
  }
}

function takeWindow(lane, size) {
  const out = new Float32Array(size)
  let filled = 0
  while (filled < size && lane.buffers.length > 0) {
    const head = lane.buffers[0]
    const need = size - filled
    if (head.length <= need) { out.set(head, filled); filled += head.length; lane.buffers.shift() }
    else { out.set(head.subarray(0, need), filled); lane.buffers[0] = head.subarray(need); filled += need }
  }
  lane.buffered -= size
  return out
}

async function startCapture() {
  ctx = new AudioContext({ sampleRate: 16000 })
  await ctx.resume()

  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  })
  streams.push(mic)
  attachLane('you', mic)

  let sysActive = false
  try {
    // Chrome: share a screen/tab WITH audio -> we get system loopback, kept as
    // its own stream (never mixed with mic) so it can be transcribed and
    // labeled separately as "Room".
    const sys = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false },
      systemAudio: 'include',
      selfBrowserSurface: 'exclude'
    })
    sys.getVideoTracks().forEach((t) => t.stop())
    if (sys.getAudioTracks().length > 0) {
      streams.push(sys)
      attachLane('room', sys)
      sysActive = true
    }
  } catch { /* mic-only fallback */ }

  return sysActive
}

// Both lanes push into the same `pump` promise chain, so only one Whisper
// inference runs at a time (the model instance isn't safe for concurrent calls)
// while still keeping "You" and "Room" audio, and their transcripts, separate.
function schedule(task) { pump = pump.then(task).catch((e) => console.error('[whisper]', e)) }

async function transcribeChunk(audio, speaker) {
  try {
    const result = await asr(audio)
    const text = (Array.isArray(result) ? result[0]?.text : result?.text ?? '').trim()
    if (text && !SILENCE.test(text) && session) {
      addSegment(text, speaker)
      await fetch('/api/session/segment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: session.id, text, speaker })
      }).catch(() => {})
    }
  } catch (e) {
    console.error('[whisper] chunk failed:', e)
    status('⚠️ Transcription error: ' + (e?.message ?? e))
  }
}

async function processLane(laneKey) {
  const lane = lanes[laneKey]
  const chunk = ctx.sampleRate * CHUNK_SECONDS
  while (lane.buffered >= chunk && recording) {
    await transcribeChunk(takeWindow(lane, chunk), laneKey)
  }
}

// On stop: transcribe everything still buffered in BOTH lanes (full chunks +
// any tail >= 1s) so short recordings and last words are never lost.
async function drainFinal() {
  const rate = ctx?.sampleRate ?? 16000
  const chunk = rate * CHUNK_SECONDS
  for (const key of ['you', 'room']) {
    const lane = lanes[key]
    if (!lane.active) continue
    while (lane.buffered >= chunk) await transcribeChunk(takeWindow(lane, chunk), key)
    if (lane.buffered >= rate) await transcribeChunk(takeWindow(lane, lane.buffered), key)
    lane.buffers = []; lane.buffered = 0
  }
}

async function start() {
  btn.disabled = true
  modelSelect.disabled = true
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
    startTimer()
    btn.textContent = '■ Stop'
    btn.classList.add('stop')
    status(
      sysActive
        ? `Recording — "You" and "Room" tracked separately ✓ → ${session.file.split(/[\\/]/).pop()}`
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
  stopTimer()
  // Stop capturing new audio immediately…
  for (const lane of Object.values(lanes)) {
    lane.processor?.disconnect()
    lane.source?.disconnect()
  }
  streams.forEach((s) => s.getTracks().forEach((t) => t.stop()))
  streams = []
  // …but transcribe what's already buffered before closing the session.
  const pending = lanes.you.buffered + lanes.room.buffered
  if (pending > 0) status('Finishing transcription…')
  schedule(drainFinal)
  await pump
  ctx?.close()
  for (const key of Object.keys(lanes)) {
    lanes[key] = { processor: null, source: null, buffers: [], buffered: 0, active: false }
  }
  btn.textContent = '● Record'
  btn.classList.remove('stop')
  btn.disabled = false
  modelSelect.disabled = false
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

// --- meeting viewer ---
const viewer = document.getElementById('viewer')
const viewerTitle = document.getElementById('viewer-title')
const viewerBody = document.getElementById('viewer-body')
document.getElementById('viewer-close').addEventListener('click', () => viewer.classList.remove('open'))

async function openMeeting(file) {
  try {
    const { content } = await (await fetch(`/api/meeting?file=${encodeURIComponent(file)}`)).json()
    viewerTitle.textContent = file
    // plain text with just **bold** rendered — enough for speaker tags + headers
    viewerBody.textContent = ''
    content.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        const b = document.createElement('b')
        b.textContent = part.slice(2, -2)
        viewerBody.appendChild(b)
      } else {
        viewerBody.appendChild(document.createTextNode(part))
      }
    })
    viewer.classList.add('open')
    viewer.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  } catch {
    status('Could not open that meeting file.')
  }
}

async function loadMeetings() {
  const el = document.getElementById('meetings')
  try {
    const { files } = await (await fetch('/api/meetings')).json()
    el.textContent = ''
    if (!files.length) {
      el.innerHTML = '<span class="muted">No meetings yet — your first transcript will appear here.</span>'
      return
    }
    files.slice(0, 10).forEach((f) => {
      const b = document.createElement('button')
      b.className = 'meeting'
      b.textContent = f
      b.addEventListener('click', () => openMeeting(f))
      el.appendChild(b)
    })
  } catch {
    el.innerHTML = '<span class="muted">Could not load meetings.</span>'
  }
}
loadMeetings()

btn.addEventListener('click', async () => {
  if (recording) { await stop(); loadMeetings() } else start()
})
