import { Recorder } from './recorder.js'
const api = window.oatmeal
const $ = (id) => document.getElementById(id)
let state,
  current,
  tab = 'notes',
  recording = false,
  busy = false,
  generation = false,
  saveTimer,
  timer,
  startedAt,
  recorder,
  stopping = false
let saveQueue = Promise.resolve(),
  editRevision = 0
const drafts = new Map()
const providerLabel = (id) =>
  ({
    local: 'Local',
    chatgpt: 'ChatGPT',
    'claude-subscription': 'Claude',
    anthropic: 'Claude API',
    openai: 'OpenAI',
    openrouter: 'OpenRouter',
    ollama: 'Ollama',
    grok: 'Grok',
  })[id] || id

function notice(message) {
  $('notice-text').textContent = message
  $('notice').hidden = false
}
$('notice-dismiss').onclick = () => {
  $('notice').hidden = true
}
function upsert(meeting) {
  const at = state.meetings.findIndex((m) => m.id === meeting.id)
  if (at < 0) state.meetings.unshift(meeting)
  else state.meetings[at] = meeting
  const draft = drafts.get(meeting.id)
  if (draft) Object.assign(meeting, draft)
  if (current?.id === meeting.id) current = meeting
  renderLibrary()
}
const date = (value) =>
  new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
const time = (seconds) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

function renderLibrary() {
  const query = $('search').value.trim().toLowerCase()
  const list = state.meetings.filter((m) =>
    `${m.title} ${m.notes} ${m.summary} ${m.segments.map((s) => s.text).join(' ')}`
      .toLowerCase()
      .includes(query),
  )
  $('library').replaceChildren()
  $('meeting-count').textContent = state.meetings.length
  if (!list.length) {
    const p = document.createElement('p')
    p.className = 'library-empty'
    p.textContent = query
      ? 'No meetings found.'
      : 'A fresh page. Your meetings will find a home here.'
    $('library').append(p)
  }
  for (const m of list) {
    const button = document.createElement('button')
    button.className = `meeting-row${current?.id === m.id ? ' selected' : ''}`
    button.setAttribute('aria-current', current?.id === m.id ? 'page' : 'false')
    const title = document.createElement('strong')
    title.textContent = m.title
    const meta = document.createElement('small')
    meta.textContent = `${date(m.createdAt)} · ${m.status === 'recording' ? 'Recording' : m.status === 'interrupted' ? 'Interrupted' : m.summary ? 'Notes ready' : m.segments.length ? `${m.segments.length} segments` : 'Personal notes'}`
    button.append(title, meta)
    button.onclick = () => selectMeeting(m)
    $('library').append(button)
  }
}
async function selectMeeting(meeting) {
  if ((recording || stopping) && current?.id !== meeting.id) {
    notice('Stop the current recording before opening another meeting.')
    return
  }
  try {
    await flushSave()
  } catch {
    return
  }
  current = state.meetings.find((m) => m.id === meeting.id) || meeting
  $('welcome').hidden = true
  $('meeting').hidden = false
  $('export').hidden = false
  $('meeting-title').value = current.title
  $('notes').value = current.notes
  $('meeting-date').textContent = new Date(current.createdAt)
    .toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
    .toUpperCase()
  $('breadcrumb').textContent = 'Meetings / My notebook'
  $('answer').replaceChildren()
  $('question').value = ''
  renderMeeting()
  renderLibrary()
  captureStatus()
}
async function newMeeting() {
  if (recording || stopping) {
    notice('Finish your current recording first.')
    return
  }
  try {
    const meeting = await api.createMeeting('Untitled meeting')
    upsert(meeting)
    await selectMeeting(meeting)
    setTab('notes')
    $('meeting-title').focus()
    $('meeting-title').select()
  } catch (error) {
    notice(error.message)
  }
}
function renderMeeting() {
  if (!current) return
  $('meeting-meta').textContent =
    `${current.segments.length} transcript segments${current.status === 'interrupted' ? ' · Recording interrupted' : ''}`
  $('segment-count').textContent = current.segments.length
  $('summary-empty').hidden = Boolean(current.summary)
  renderMarkdown($('summary-output'), current.summary)
  $('generate').textContent = generation
    ? 'Writing notes…'
    : current.summary
      ? '✧ Regenerate notes'
      : '✧ Generate notes'
  $('generate').disabled =
    generation ||
    recording ||
    stopping ||
    (!current.notes.trim() && !current.segments.length)
  $('ask').disabled = generation || recording || stopping
  $('transcript-empty').hidden = current.segments.length > 0
  $('transcript').replaceChildren()
  for (const segment of current.segments) {
    const block = document.createElement('div')
    block.className = 'utterance'
    const header = document.createElement('div')
    header.className = 'utterance-header'
    const speaker = document.createElement('strong')
    speaker.textContent = segment.speaker === 'you' ? 'YOU' : 'ROOM'
    const stamp = document.createElement('time')
    stamp.textContent = time(segment.offset)
    const p = document.createElement('p')
    p.textContent = segment.text
    header.append(speaker, stamp)
    block.append(header, p)
    $('transcript').append(block)
  }
}
function renderMarkdown(target, content) {
  target.replaceChildren()
  let list
  for (const line of (content || '').split('\n')) {
    if (!line.trim()) {
      list = null
      continue
    }
    const heading = line.match(/^#{1,4}\s+(.+)$/),
      bullet = line.match(/^(?:[-*]|\d+\.)\s+(.+)$/)
    let element
    if (bullet) {
      if (!list) {
        list = document.createElement('ul')
        target.append(list)
      }
      element = document.createElement('li')
      list.append(element)
    } else {
      list = null
      element = document.createElement(heading ? 'h3' : 'p')
      target.append(element)
    }
    const value = heading?.[1] || bullet?.[1] || line
    for (const part of value.split(/(\*\*[^*]+\*\*)/g)) {
      if (part.startsWith('**') && part.endsWith('**')) {
        const strong = document.createElement('strong')
        strong.textContent = part.slice(2, -2)
        element.append(strong)
      } else element.append(document.createTextNode(part))
    }
  }
}
function setTab(next) {
  tab = next
  for (const name of ['notes', 'summary', 'transcript']) {
    $(`${name}-panel`).hidden = name !== tab
    $(`${name}-tab`).setAttribute('aria-selected', String(name === tab))
    $(`${name}-tab`).tabIndex = name === tab ? 0 : -1
  }
}
document.querySelectorAll('[data-tab]').forEach((button) => {
  button.onclick = () => setTab(button.dataset.tab)
  button.onkeydown = (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    const names = ['notes', 'summary', 'transcript']
    const next =
      names[(names.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 2)) % 3]
    setTab(next)
    $(`${next}-tab`).focus()
  }
})

function queueSave() {
  if (!current) return
  editRevision++
  const draft = { title: $('meeting-title').value, notes: $('notes').value }
  drafts.set(current.id, draft)
  Object.assign(current, draft)
  $('save-status').textContent = 'Saving…'
  renderLibrary()
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    flushSave().catch(() => {})
  }, 400)
}
async function flushSave() {
  clearTimeout(saveTimer)
  if (!current || !drafts.has(current.id)) return saveQueue
  const id = current.id,
    draft = { ...drafts.get(id) },
    revision = editRevision
  const task = saveQueue
    .catch(() => {})
    .then(async () => {
      try {
        const saved = await api.saveMeeting({ id, ...draft })
        if (revision === editRevision) {
          drafts.delete(id)
          $('save-status').textContent = 'Saved locally'
        }
        upsert(saved)
      } catch (error) {
        $('save-status').textContent = 'Not saved'
        notice(
          'Your latest edit could not be saved. Keep Oatmeal open and try again.',
        )
        throw error
      }
    })
  saveQueue = task
  return task
}
$('meeting-title').oninput = queueSave
$('notes').oninput = () => {
  queueSave()
  $('generate').disabled =
    generation ||
    recording ||
    stopping ||
    (!current.notes.trim() && !current.segments.length)
}
$('search').oninput = renderLibrary
$('new-meeting').onclick = newMeeting
$('welcome-new').onclick = newMeeting
$('export').onclick = async () => {
  try {
    await flushSave()
    await api.exportMeeting(current.id)
  } catch (error) {
    notice(error.message)
  }
}
$('import').onclick = async () => {
  try {
    const imported = await api.importMeetings()
    imported.forEach(upsert)
    if (imported[0]) await selectMeeting(imported[0])
  } catch (error) {
    notice(error.message)
  }
}

function captureStatus(detail) {
  $('record').disabled = !current || busy || generation
  $('record').classList.toggle('recording', recording)
  $('record').textContent = stopping
    ? 'Retry saving'
    : recording
      ? '■ Stop'
      : '● Record'
  $('system-audio').disabled = recording || busy || stopping
  $('record-dot').classList.toggle('active', recording)
  $('record-state').textContent = recording
    ? 'In the conversation.'
    : current
      ? 'Ready when you are.'
      : 'Your next good conversation.'
  $('record-detail').textContent =
    detail ||
    (current ? 'Tell others before recording.' : 'Start a meeting to begin.')
}
$('record').onclick = async () => {
  if (!current || busy) return
  busy = true
  captureStatus()
  try {
    if (recording || stopping) {
      recording = false
      stopping = true
      clearInterval(timer)
      captureStatus('Finishing and saving the conversation…')
      if (recorder.context) await recorder.stop()
      else await recorder.retryFailed()
      upsert(await api.stopCapture(current.id))
      stopping = false
      $('timer').hidden = true
      renderMeeting()
      captureStatus(
        'Recording stopped. Review the transcript before generating notes.',
      )
    } else {
      recorder = new Recorder(api, notice)
      recorder.prepare($('system-audio').checked)
      await flushSave()
      captureStatus('Preparing the local speech model…')
      upsert(await api.startCapture(current.id))
      const offset = current.segments.length
        ? current.segments.at(-1).offset + 6
        : 0
      try {
        const room = await recorder.start(
          current.id,
          $('system-audio').checked,
          offset,
        )
        recording = true
        startedAt = Date.now()
        $('timer').hidden = false
        $('timer').textContent = '00:00'
        timer = setInterval(() => {
          $('timer').textContent = time((Date.now() - startedAt) / 1000)
        }, 500)
        captureStatus(
          room
            ? 'Microphone + meeting audio · Transcribing locally'
            : 'Microphone only · Transcribing locally',
        )
        if ($('system-audio').checked && !room)
          notice(
            'Meeting audio is unavailable. Only your microphone is being recorded. Check system audio permissions or use a loopback microphone input.',
          )
      } catch (error) {
        await api.stopCapture(current.id)
        throw error
      }
    }
  } catch (error) {
    if (!recording && !stopping) await recorder?.cleanup()
    notice(error.message)
    captureStatus(
      stopping
        ? 'Some audio is not saved yet. Retry before closing.'
        : 'Could not start. Check microphone permissions and retry.',
    )
  } finally {
    busy = false
    $('record').disabled = false
    $('system-audio').disabled = recording || stopping
    renderMeeting()
  }
}

function cloudConsent() {
  if (['local', 'ollama'].includes(state.settings.provider))
    return Promise.resolve(true)
  return new Promise((resolve) => {
    const dialog = $('consent-dialog')
    $('consent-copy').textContent =
      `Oatmeal will send “${current.title}” to ${state.providers[state.settings.provider].label} to answer this request.`
    const finish = (value) => {
      dialog.close()
      resolve(value)
    }
    $('consent-cancel').onclick = () => finish(false)
    $('consent-accept').onclick = () => finish(true)
    dialog.oncancel = (event) => {
      event.preventDefault()
      finish(false)
    }
    dialog.showModal()
  })
}
$('generate').onclick = async () => {
  try {
    await flushSave()
    if (!(await cloudConsent())) return
    const id = current.id
    generation = true
    renderMeeting()
    captureStatus('Writing notes. Your transcript is already saved.')
    upsert(await api.generate({ id, consent: true }))
    renderMeeting()
  } catch (error) {
    notice(error.message)
  } finally {
    generation = false
    renderMeeting()
    captureStatus()
  }
}
$('ask').onclick = async () => {
  if (!$('question').value.trim()) return
  try {
    await flushSave()
    if (!(await cloudConsent())) return
    const id = current.id,
      question = $('question').value
    generation = true
    renderMeeting()
    captureStatus()
    $('answer').textContent = 'Looking through this meeting…'
    const answer = await api.ask({ id, question, consent: true })
    if (current.id === id) renderMarkdown($('answer'), answer)
  } catch (error) {
    notice(error.message)
    $('answer').textContent = ''
  } finally {
    generation = false
    renderMeeting()
    captureStatus()
  }
}
$('recover').onclick = async () => {
  $('recover').disabled = true
  try {
    const result = await api.recoverAudio()
    result.meetings.forEach(upsert)
    $('recovery').hidden = result.remaining === 0
    if (result.remaining)
      notice(
        'Some audio could not be recovered. Check the speech model download and try again.',
      )
    renderMeeting()
  } catch (error) {
    notice(error.message)
  } finally {
    $('recover').disabled = false
  }
}

function populate(select, entries) {
  select.replaceChildren(
    ...Object.entries(entries).map(([value, config]) => {
      const option = document.createElement('option')
      option.value = value
      option.textContent =
        config.label + (config.size ? ` (${config.size})` : '')
      return option
    }),
  )
}
async function showSettings() {
  $('provider').value = state.settings.provider
  $('speech-model').value = state.settings.speechModel || 'tiny'
  $('local-model').value = state.settings.localModel || 'small'
  $('settings-error').textContent = ''
  $('settings-dialog').showModal()
  providerFields()
}
async function providerFields() {
  const id = $('provider').value,
    config = state.providers[id]
  $('provider-description').textContent =
    config.description ||
    'Meeting text is sent to this provider only when you request AI help. API usage is billed separately from chat subscriptions.'
  $('provider-model').value = state.settings.models?.[id] || config.model || ''
  $('api-key').value = ''
  $('key-saved').textContent = state.settings.savedKeys?.includes(id)
    ? 'Saved securely'
    : ''
  $('remove-key').hidden = !state.settings.savedKeys?.includes(id)
  $('key-field').hidden = !config.key
  $('local-field').hidden = id !== 'local'
  $('model-field').hidden = id === 'local'
  const subscription = ['chatgpt', 'claude-subscription'].includes(id)
  $('subscription-field').hidden = !subscription
  if (subscription) {
    $('account-status').textContent = 'Checking connection…'
    try {
      const result = await api.authStatus(id)
      if ($('provider').value !== id) return
      $('account-status').textContent = result.connected
        ? `Connected${result.label ? ` · ${result.label}` : ''}`
        : 'Not connected'
      $('connect').hidden = result.connected
      $('disconnect').hidden = !result.connected
    } catch {
      $('account-status').textContent = 'Not connected'
      $('connect').hidden = false
      $('disconnect').hidden = true
    }
  }
}
$('settings-open').onclick = showSettings
$('settings-close').onclick = () => $('settings-dialog').close()
$('provider').onchange = providerFields
$('settings-form').onsubmit = async (event) => {
  event.preventDefault()
  try {
    const update = {
      provider: $('provider').value,
      model: $('provider-model').value.trim(),
      speechModel: $('speech-model').value,
      localModel: $('local-model').value,
    }
    if ($('api-key').value.trim()) update.apiKey = $('api-key').value.trim()
    state.settings = await api.saveSettings(update)
    $('api-key').value = ''
    $('provider-badge').textContent = providerLabel(state.settings.provider)
    $('settings-dialog').close()
  } catch (error) {
    $('settings-error').textContent = error.message
  }
}
$('remove-key').onclick = async () => {
  try {
    state.settings = await api.saveSettings({
      provider: $('provider').value,
      apiKey: '',
    })
    providerFields()
  } catch (error) {
    $('settings-error').textContent = error.message
  }
}
$('connect').onclick = async () => {
  $('connect').disabled = true
  try {
    await api.login($('provider').value)
    $('account-status').textContent = 'Finish signing in in your browser…'
  } catch (error) {
    $('settings-error').textContent = error.message
  } finally {
    $('connect').disabled = false
  }
}
$('disconnect').onclick = async () => {
  try {
    await api.logout($('provider').value)
    providerFields()
  } catch (error) {
    $('settings-error').textContent = error.message
  }
}
for (const kind of ['speech', 'text']) {
  $(`download-${kind}`).onclick = async () => {
    const button = $(`download-${kind}`)
    button.disabled = true
    $('model-progress').textContent =
      'Preparing download. This may take a few minutes…'
    try {
      await api.loadModel({
        kind,
        name: $(kind === 'speech' ? 'speech-model' : 'local-model').value,
      })
      $('model-progress').textContent =
        'Model ready. It is now available offline.'
    } catch (error) {
      $('settings-error').textContent = error.message
      $('model-progress').textContent =
        'Download did not finish. You can retry.'
    } finally {
      button.disabled = false
    }
  }
}
$('open-data').onclick = () =>
  api.openData().catch((error) => {
    $('settings-error').textContent = error.message
  })

async function initialize() {
  state = await api.bootstrap()
  document.body.classList.add(`platform-${state.platform}`)
  if (state.platform !== 'darwin')
    document.querySelector('kbd').textContent = 'Ctrl N'
  populate($('provider'), state.providers)
  populate($('speech-model'), state.speechModels)
  populate($('local-model'), state.textModels)
  $('provider-badge').textContent = providerLabel(state.settings.provider)
  $('version').textContent = `Oatmeal ${state.version}`
  $('recovery').hidden = !state.pendingAudio
  renderLibrary()
  api.on('meeting:updated', (meeting) => {
    upsert(meeting)
    renderMeeting()
  })
  api.on('capture:queue', (count) => {
    if (count > 3)
      $('record-detail').textContent =
        `${count} audio segments queued safely on disk. Transcription is catching up.`
  })
  api.on('model:progress', (progress) => {
    const message =
      progress.status === 'progress'
        ? `${progress.kind === 'speech' ? 'Speech' : 'Text'} model · ${Math.round(progress.progress || 0)}% of ${progress.file || 'file'}`
        : progress.status === 'ready'
          ? 'Model ready.'
          : 'Loading model…'
    $('model-progress').textContent = message
    if (busy && !recording) $('record-detail').textContent = message
  })
  api.on('auth:updated', (result) => {
    if (!result.success)
      $('settings-error').textContent =
        'Sign-in did not finish. Please try again.'
    providerFields()
  })
  api.on('app:error', (message) => {
    notice(message)
    $('recovery').hidden = false
  })
  api.on('app:new-meeting', newMeeting)
  api.on('app:settings', showSettings)
}
window.addEventListener('beforeunload', (event) => {
  if (drafts.size) {
    event.preventDefault()
    event.returnValue = ''
    flushSave().catch(() => {})
  }
})
initialize().catch((error) =>
  notice(`Oatmeal could not load: ${error.message}`),
)
