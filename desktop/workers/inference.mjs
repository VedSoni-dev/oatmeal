import { parentPort, workerData } from 'node:worker_threads'
import { pipeline, env } from '@huggingface/transformers'
import { SPEECH_MODELS, TEXT_MODELS } from '../core/models.mjs'

env.cacheDir = workerData.cacheDir
env.allowLocalModels = false
let speech, speechId, text, textId
let queue = Promise.resolve()

async function load(kind, name, requestId) {
  const config = (kind === 'speech' ? SPEECH_MODELS : TEXT_MODELS)[name]
  if (!config) throw new Error('Unknown model')
  if (kind === 'speech' && speechId === name) return speech
  if (kind === 'text' && textId === name) return text
  const old = kind === 'speech' ? speech : text
  if (old) await old.dispose()
  if (kind === 'speech') {
    speech = null
    speechId = null
  } else {
    text = null
    textId = null
  }
  const model = await pipeline(config.task, config.id, {
    device: 'cpu',
    dtype: kind === 'speech' ? 'q8' : 'q4',
    progress_callback: (p) =>
      parentPort.postMessage({
        event: 'progress',
        requestId,
        kind,
        name,
        status: p.status,
        file: p.file,
        progress: p.progress,
      }),
  })
  if (kind === 'speech') {
    speech = model
    speechId = name
  } else {
    text = model
    textId = name
  }
  return model
}

parentPort.on('message', (message) => {
  queue = queue
    .then(async () => {
      const { id, command, name, kind } = message
      try {
        let result
        if (command === 'load') {
          await load(kind, name, id)
          result = { ready: true }
        } else if (command === 'transcribe') {
          const model = await load('speech', name, id)
          const audio = new Float32Array(message.audio)
          const rms = Math.sqrt(
            audio.reduce((sum, sample) => sum + sample * sample, 0) /
              audio.length,
          )
          if (rms < 0.002) result = ''
          else {
            const output = await model(audio, {
              chunk_length_s: 30,
              stride_length_s: 3,
              return_timestamps: false,
            })
            result = output.text?.trim() || ''
            if (/^\s*[[（(].*[\]）)]\s*$/.test(result)) result = ''
          }
        } else if (command === 'generate') {
          const model = await load('text', name, id)
          const output = await model(
            [
              { role: 'system', content: message.system },
              { role: 'user', content: message.prompt },
            ],
            { max_new_tokens: 128, do_sample: false, return_full_text: false },
          )
          const generated = output[0]?.generated_text
          result =
            typeof generated === 'string'
              ? generated
              : generated?.at(-1)?.content
          if (!result) throw new Error('The local model returned no text.')
        } else throw new Error('Unknown inference command')
        parentPort.postMessage({ id, result })
      } catch (error) {
        parentPort.postMessage({
          id,
          error: `Local model failed: ${String(error.message).slice(0, 300)}`,
        })
      }
    })
    .catch(() => {})
})
