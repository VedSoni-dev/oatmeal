import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MeetingStore,
  SettingsStore,
  markdown,
} from '../desktop/core/store.mjs'
import {
  cloudCompletion,
  splitText,
  summarize,
} from '../desktop/core/providers.mjs'
import { localNotes, localAnswer } from '../desktop/core/local-notes.mjs'

test('concurrent transcript and note writes survive restart and interrupted capture recovers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oatmeal-store-'))
  const store = await new MeetingStore(root).init()
  const first = await store.create('Standup'),
    second = await store.create('Standup')
  assert.notEqual(first.id, second.id)
  await Promise.all([
    store.update(first.id, (m) => {
      m.notes = 'Keep the deadline'
      m.status = 'recording'
    }),
    ...Array.from({ length: 30 }, (_, index) =>
      store.update(first.id, (m) => {
        m.segments.push({
          id: String(index),
          text: `Segment ${index}`,
          speaker: 'you',
          offset: index * 6,
        })
      }),
    ),
  ])
  const reopened = await new MeetingStore(root).init()
  await reopened.recover()
  const restored = await reopened.get(first.id)
  assert.equal(restored.notes, 'Keep the deadline')
  assert.equal(restored.segments.length, 30)
  assert.equal(restored.status, 'interrupted')
  assert.match(markdown(restored), /\[0:06\] \*\*You:\*\* Segment 1/)
  assert.throws(() => store.path('../secrets'), /Invalid meeting/)
})

test('settings keep encrypted credentials out of public state and preserve keys on edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oatmeal-settings-'))
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from([...value].reverse().join('')),
    decryptString: (value) => [...value.toString()].reverse().join(''),
  }
  const store = new SettingsStore(root, encryption)
  await Promise.all([
    store.save({
      provider: 'openai',
      apiKey: 'secret-test-key',
      model: 'model-a',
    }),
    store.save({ provider: 'anthropic', apiKey: 'second-secret' }),
  ])
  const data = await store.public()
  assert.equal(data.keys, undefined)
  assert.deepEqual(data.savedKeys.sort(), ['anthropic', 'openai'])
  assert.equal(await store.key('openai'), 'secret-test-key')
  assert.ok(
    !(await readFile(join(root, 'settings.json'), 'utf8')).includes(
      'secret-test-key',
    ),
  )
  await store.save({ provider: 'openai', model: 'new-model' })
  assert.equal(await store.key('openai'), 'secret-test-key')
  await store.save({ provider: 'openai', apiKey: '' })
  assert.equal(await store.key('openai'), '')
  encryption.isEncryptionAvailable = () => false
  await assert.rejects(
    store.save({ provider: 'openai', apiKey: 'new-secret' }),
    /not saved/,
  )
})

test('OpenAI compatible adapters use the correct host, auth and request format', async () => {
  for (const [provider, host] of [
    ['openai', 'api.openai.com'],
    ['grok', 'api.x.ai'],
    ['openrouter', 'openrouter.ai'],
    ['ollama', '127.0.0.1'],
  ]) {
    const result = await cloudCompletion({
      provider,
      key: 'test-key',
      model: 'chosen-model',
      system: 'System',
      prompt: 'Transcript',
      fetcher: async (url, options) => {
        assert.equal(new URL(url).hostname, host)
        assert.equal(options.headers.Authorization, 'Bearer test-key')
        assert.equal(options.redirect, 'error')
        assert.deepEqual(JSON.parse(options.body).messages, [
          { role: 'system', content: 'System' },
          { role: 'user', content: 'Transcript' },
        ])
        return Response.json({
          choices: [{ message: { content: 'Meeting summary' } }],
        })
      },
    })
    assert.equal(result, 'Meeting summary')
  }
})

test('Claude API uses Messages, its separate system field, and text blocks', async () => {
  const result = await cloudCompletion({
    provider: 'anthropic',
    key: 'test',
    system: 'System',
    prompt: 'Hello',
    fetcher: async (url, options) => {
      assert.ok(url.endsWith('/v1/messages'))
      assert.equal(options.headers['x-api-key'], 'test')
      const body = JSON.parse(options.body)
      assert.equal(body.system, 'System')
      assert.equal(body.messages.length, 1)
      return Response.json({
        content: [
          { type: 'text', text: 'One' },
          { type: 'thinking', thinking: 'Private' },
          { type: 'text', text: 'Two' },
        ],
      })
    },
  })
  assert.equal(result, 'One\nTwo')
})

test('API errors never expose raw provider secrets; empty completions are rejected', async () => {
  await assert.rejects(
    cloudCompletion({ provider: 'openai', key: '', system: '', prompt: '' }),
    /key in Settings/,
  )
  await assert.rejects(
    cloudCompletion({
      provider: 'openai',
      key: 'private-key',
      system: '',
      prompt: '',
      fetcher: async () =>
        Response.json({ error: 'private-key' }, { status: 401 }),
    }),
    (error) => !error.message.includes('private-key') && error.status === 401,
  )
  await assert.rejects(
    cloudCompletion({
      provider: 'openai',
      key: 'test',
      system: '',
      prompt: '',
      fetcher: async () => Response.json({ choices: [] }),
    }),
    /no text/,
  )
})

test('long meetings reduce all chunks without dropping the tail', async () => {
  const source = 'A'.repeat(18000) + '\nLAST DECISION'
  assert.equal(splitText(source, 7000).join(''), source)
  const prompts = []
  const result = await summarize(
    {
      title: 'Long',
      notes: '',
      segments: [{ offset: 0, speaker: 'room', text: source }],
    },
    async (system, prompt) => {
      prompts.push(prompt)
      return prompt.includes('LAST DECISION')
        ? 'Keep LAST DECISION'
        : 'Partial notes'
    },
    true,
  )
  assert.ok(prompts.length > 2)
  assert.match(result, /LAST DECISION/)
  assert.ok(prompts.every((p) => p.length <= 9000))
})

test('small local models cannot inject invented facts into notes or answers', async () => {
  const meeting = {
    notes: '',
    segments: [
      {
        speaker: 'you',
        offset: 12,
        text: 'The review is on Friday. Maya will send the draft tomorrow.',
      },
    ],
  }
  const badModel = async () => 'John is the project manager.\n9999, 2'
  const notes = await localNotes(meeting, badModel)
  assert.match(notes, /Maya will send the draft tomorrow/)
  assert.doesNotMatch(notes, /John|project manager|9999/)
  assert.match(notes, /You, 0:12/)
  const answer = await localAnswer(meeting, 'Who sends the draft?', badModel)
  assert.match(answer, /Maya will send the draft tomorrow/)
  assert.doesNotMatch(answer, /John|project manager/)
  assert.match(
    await localAnswer(meeting, 'What was lunch?', async () => '0'),
    /did not find supporting excerpts/,
  )
  const fallback = await localNotes(
    meeting,
    async () => 'not valid identifiers',
  )
  assert.match(fallback, /review is on Friday/)
})
