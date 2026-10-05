import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export async function atomicWrite(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, value, { mode: 0o600 })
  await rename(temporary, path)
}

export class MeetingStore {
  constructor(root) {
    this.root = root
    this.pending = new Map()
  }
  async init() {
    await mkdir(this.root, { recursive: true })
    return this
  }
  path(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid meeting ID')
    return join(this.root, `${id}.json`)
  }
  async create(title = 'Untitled meeting') {
    const meeting = {
      id: randomUUID(),
      title: String(title).trim().slice(0, 200) || 'Untitled meeting',
      createdAt: new Date().toISOString(),
      endedAt: null,
      notes: '',
      summary: '',
      segments: [],
      status: 'draft',
    }
    await atomicWrite(this.path(meeting.id), JSON.stringify(meeting, null, 2))
    return meeting
  }
  async get(id) {
    return JSON.parse(await readFile(this.path(id), 'utf8'))
  }
  async list() {
    const result = []
    for (const file of await readdir(this.root)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(file)) continue
      try {
        result.push(JSON.parse(await readFile(join(this.root, file), 'utf8')))
      } catch {
        /* A damaged file must not hide the rest of the library. */
      }
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  update(id, mutate) {
    const next = (this.pending.get(id) || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const meeting = await this.get(id)
        mutate(meeting)
        await atomicWrite(this.path(id), JSON.stringify(meeting, null, 2))
        return meeting
      })
    this.pending.set(id, next)
    next
      .finally(() => {
        if (this.pending.get(id) === next) this.pending.delete(id)
      })
      .catch(() => {})
    return next
  }
  async recover() {
    for (const meeting of await this.list()) {
      if (meeting.status === 'recording')
        await this.update(meeting.id, (m) => {
          m.status = 'interrupted'
          m.endedAt = new Date().toISOString()
        })
    }
  }
}

export function markdown(meeting) {
  const transcript = meeting.segments
    .map(
      (s) =>
        `[${Math.floor(s.offset / 60)}:${String(Math.floor(s.offset % 60)).padStart(2, '0')}] **${s.speaker === 'you' ? 'You' : 'Room'}:** ${s.text}`,
    )
    .join('\n\n')
  return `# ${meeting.title}\n\n${meeting.createdAt}\n\n## My notes\n\n${meeting.notes}\n\n## Summary\n\n${meeting.summary}\n\n## Transcript\n\n${transcript}\n`
}

export class SettingsStore {
  constructor(root, encryption) {
    this.root = root
    this.encryption = encryption
    this.queue = Promise.resolve()
  }
  async read() {
    try {
      return JSON.parse(
        await readFile(join(this.root, 'settings.json'), 'utf8'),
      )
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      return {
        provider: 'local',
        models: {},
        keys: {},
        speechModel: 'tiny',
        localModel: 'small',
      }
    }
  }
  async public() {
    const { keys = {}, ...settings } = await this.read()
    return {
      ...settings,
      savedKeys: Object.keys(keys).filter((key) => Boolean(keys[key])),
    }
  }
  async key(provider) {
    const value = (await this.read()).keys?.[provider]
    return value
      ? this.encryption.decryptString(Buffer.from(value, 'base64'))
      : ''
  }
  save(update) {
    const next = this.queue
      .catch(() => {})
      .then(async () => {
        const current = await this.read()
        if (update.provider) current.provider = update.provider
        if (update.model !== undefined && update.provider)
          current.models = {
            ...current.models,
            [update.provider]: update.model,
          }
        if (update.speechModel) current.speechModel = update.speechModel
        if (update.localModel) current.localModel = update.localModel
        if (update.apiKey !== undefined && update.provider) {
          current.keys ||= {}
          if (update.apiKey) {
            if (!this.encryption.isEncryptionAvailable())
              throw new Error(
                'The operating system credential store is unavailable. Your key was not saved.',
              )
            current.keys[update.provider] = this.encryption
              .encryptString(update.apiKey)
              .toString('base64')
          } else delete current.keys[update.provider]
        }
        await atomicWrite(
          join(this.root, 'settings.json'),
          JSON.stringify(current, null, 2),
        )
        return this.public()
      })
    this.queue = next
    return next
  }
}
