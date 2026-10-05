// Adapted from https://publikhq.com/sdk/publik.ts.md (2026-10-05).
// Main process only. The public app token can be packaged; install keys cannot.
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, chmod } from 'node:fs/promises'
import { arch, homedir, hostname, platform } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicWrite } from './store.mjs'

export const APP_SLUG = 'oatmeal-vedsoni-dev'
export const APP_VERSION = '2.0.0'
export const DEFAULT_BASE_URL = 'https://publikhq.com/api/v1'
export const TIERS = ['publik-fast', 'publik-balanced', 'publik-smart']
export const DISCLOSURE =
  'This app can use publik API for its AI features: no key to paste, priced per use in dollars from a publik balance that starts at $0.00. ' +
  "Linking this computer to a publik account gives $0.05 of free use, once. Your prompts go through publik's servers to the model; you can switch to your own key at any time."

export function appToken(env = process.env) {
  if (env.PUBLIK_APP_TOKEN?.trim()) return env.PUBLIK_APP_TOKEN.trim()
  for (
    let dir = dirname(fileURLToPath(import.meta.url));
    ;
    dir = dirname(dir)
  ) {
    const file = join(dir, 'publik-app-token.txt')
    if (existsSync(file)) return readFileSync(file, 'utf8').trim()
    if (dirname(dir) === dir) return ''
  }
}

export function credentialPath() {
  const base =
    platform() === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : platform() === 'win32'
        ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
        : process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(base, 'publik', 'apps', `${APP_SLUG}.json`)
}

export function publikLink(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      url.hostname === 'publikhq.com' &&
      !url.username &&
      !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}

export function balanceLine(micros, state = 'anonymous') {
  if (!Number.isFinite(micros)) return 'Balance not available yet'
  const dollars = `$${(micros / 1_000_000).toFixed(2)}`
  return micros === 0 && state === 'anonymous'
    ? '$0.00 until linked · $0.05 free at first link'
    : `${dollars} of publik balance`
}

export class PublikError extends Error {
  constructor(message, status, actionUrl) {
    super(message)
    this.status = status
    this.actionUrl = publikLink(actionUrl)
  }
}
const cleanMessage = (message) =>
  typeof message === 'string'
    ? message
        .replace(/(?:pk|pat|pbt)_[A-Za-z0-9_-]+/g, '[redacted]')
        .slice(0, 1000)
    : 'publik API could not complete this request.'

export class PublikClient {
  constructor({
    path = credentialPath(),
    env = process.env,
    token = () => appToken(env),
    fetcher = (url, options) => fetch(url, options),
    notify = () => {},
    log = (line) => console.info(line),
  } = {}) {
    this.path = path
    this.env = env
    this.token = token
    this.fetcher = fetcher
    this.notify = notify
    this.log = log
    this.provisioning = null
    this.writeQueue = Promise.resolve()
    this.meter = {}
  }
  async readCredential() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8'))
      return typeof data.key === 'string' && data.key.startsWith('pk_')
        ? data
        : null
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw new Error(
        'The saved publik credential could not be read. Use your own API key or restore access to the credential file.',
      )
    }
  }
  async writeCredential(credential) {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    await atomicWrite(this.path, JSON.stringify(credential, null, 2))
    await chmod(this.path, 0o600)
  }
  async resolve(userKey) {
    if (userKey)
      return {
        kind: 'own',
        baseURL: DEFAULT_BASE_URL,
        apiKey: userKey,
        credential: null,
      }
    if (this.env.PUBLIK_API_KEY)
      return {
        kind: 'environment',
        baseURL: this.env.PUBLIK_API_BASE_URL || DEFAULT_BASE_URL,
        apiKey: this.env.PUBLIK_API_KEY,
        credential: null,
      }
    const credential = await this.readCredential()
    if (credential)
      return {
        kind: 'install',
        baseURL: credential.base_url || DEFAULT_BASE_URL,
        apiKey: credential.key,
        credential,
      }
    return { kind: 'needs_consent' }
  }
  async status(userKey) {
    const provider = await this.resolve(userKey)
    this.selectMeter(provider)
    const c = { ...provider.credential, ...this.accountMetadata }
    return {
      ready: provider.kind !== 'needs_consent',
      source: provider.kind,
      available:
        provider.kind !== 'needs_consent' || this.token().startsWith('pat_'),
      disclosure: DISCLOSURE,
      tiers: TIERS,
      ...this.meter,
      balance: balanceLine(
        this.balanceMicros ?? c?.balance_micros,
        c?.claim_state,
      ),
      claimState: c?.claim_state || 'anonymous',
      claimUrl: publikLink(c?.claim_url),
      addCreditUrl: publikLink(c?.add_credit_url),
      cost: c?.cost_sentence || '',
    }
  }
  selectMeter(provider) {
    if (this.meterKey !== provider.apiKey) {
      this.meterKey = provider.apiKey
      this.meter = {}
      this.accountMetadata = {}
      this.balanceMicros = undefined
    }
  }
  async request(url, options = {}) {
    let response
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
        throw new Error('Invalid endpoint')
      response = await this.fetcher(url, {
        ...options,
        redirect: 'error',
        signal: AbortSignal.timeout(180_000),
      })
    } catch {
      throw new Error(
        'Could not reach publik API. Check your connection and try again. Your own-key and local options remain available.',
      )
    }
    const body = await response.json().catch(() => ({}))
    return { response, body }
  }
  provision(accepted) {
    if (accepted !== true)
      return Promise.reject(
        new Error(
          'Accept the publik disclosure before setting up this computer.',
        ),
      )
    if (this.provisioning) return this.provisioning
    this.provisioning = this.provisionInstall().finally(() => {
      this.provisioning = null
    })
    return this.provisioning
  }
  async provisionInstall() {
    const existing = await this.resolve()
    if (existing.kind !== 'needs_consent') return this.status()
    const token = this.token()
    if (!token.startsWith('pat_'))
      throw new Error(
        'This build has no publik API app token. Use your own key for now.',
      )
    // Retain an ID even if a network response is lost. The reference's replay
    // handling permits one fresh ID if a successful replay no longer returns a key.
    const idPath = `${this.path}.install-id`
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    let installId
    try {
      installId = (await readFile(idPath, 'utf8')).trim()
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (!/^[0-9a-f-]{36}$/.test(installId || '')) {
      installId = randomUUID()
      await atomicWrite(idPath, installId)
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const { response, body } = await this.request(
        `${DEFAULT_BASE_URL}/installs`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            app_token: token,
            app_slug: APP_SLUG,
            app_version: APP_VERSION,
            os:
              platform() === 'darwin'
                ? 'macos'
                : platform() === 'win32'
                  ? 'windows'
                  : 'linux',
            arch: arch(),
            device_name: hostname().slice(0, 120),
            install_id: installId,
            disclosure_version: 1,
            dialects: ['chat_completions'],
          }),
        },
      )
      if (
        [200, 201].includes(response.status) &&
        typeof body.key === 'string' &&
        body.key.startsWith('pk_')
      ) {
        // Provisioning responses may only return the documented publik endpoint.
        if (
          body.base_url &&
          body.base_url.replace(/\/$/, '') !== DEFAULT_BASE_URL
        )
          throw new Error('publik returned an unexpected API endpoint.')
        await this.writeCredential({
          key: body.key,
          base_url: DEFAULT_BASE_URL,
          install_id: body.install_id || installId,
          claim_url: publikLink(body.claim_url),
          claim_state: body.claim_state === 'claimed' ? 'claimed' : 'anonymous',
          add_credit_url: publikLink(body.wallet?.add_credit_url),
          cost_sentence:
            typeof body.disclosure?.cost === 'string'
              ? body.disclosure.cost
              : null,
          balance_micros: Number.isFinite(body.balance_micros)
            ? body.balance_micros
            : null,
        })
        const status = await this.status()
        this.notify(status)
        return status
      }
      if (response.status === 200 || body.error?.type === 'install_revoked') {
        installId = randomUUID()
        await atomicWrite(idPath, installId)
        continue
      }
      throw new PublikError(
        cleanMessage(body.error?.message),
        response.status,
        body.error?.top_up_url,
      )
    }
    throw new Error(
      'publik API could not set up this computer. Use your own key for now.',
    )
  }
  async updateCredential(patch) {
    const task = this.writeQueue
      .catch(() => {})
      .then(async () => {
        const current = await this.readCredential()
        if (current) await this.writeCredential({ ...current, ...patch })
      })
    this.writeQueue = task
    return task
  }
  async wallet(userKey) {
    const provider = await this.resolve(userKey)
    if (provider.kind === 'needs_consent') return this.status(userKey)
    const { response, body } = await this.request(
      `${provider.baseURL.replace(/\/$/, '')}/wallet`,
      { headers: { Authorization: `Bearer ${provider.apiKey}` } },
    )
    await this.readMeter(response, provider)
    if (!response.ok)
      throw new PublikError(
        cleanMessage(body.error?.message),
        response.status,
        body.error?.top_up_url,
      )
    const wallet = body.wallet || body
    const patch = {}
    if (Number.isFinite(wallet.balance_micros))
      this.balanceMicros = patch.balance_micros = wallet.balance_micros
    if (['claimed', 'anonymous'].includes(wallet.claim_state))
      patch.claim_state = wallet.claim_state
    if (publikLink(wallet.claim_url))
      patch.claim_url = publikLink(wallet.claim_url)
    if (publikLink(wallet.add_credit_url))
      patch.add_credit_url = publikLink(wallet.add_credit_url)
    this.accountMetadata = { ...this.accountMetadata, ...patch }
    if (Number.isFinite(wallet.week?.used_micros))
      this.meter.weekUsage = `$${(wallet.week.used_micros / 1_000_000).toFixed(4)}`
    if (Number.isFinite(wallet.week?.budget_micros))
      this.meter.weekBudget = `$${(wallet.week.budget_micros / 1_000_000).toFixed(2)}`
    else if (wallet.week?.budget_micros === null) delete this.meter.weekBudget
    if (
      typeof wallet.week?.resets_at === 'string' &&
      Number.isFinite(Date.parse(wallet.week.resets_at))
    )
      this.meter.weekReset = new Date(wallet.week.resets_at).toLocaleString()
    if (provider.credential && Object.keys(patch).length)
      await this.updateCredential(patch)
    const status = await this.status(userKey)
    this.notify(status)
    return status
  }
  async readMeter(response, provider) {
    this.selectMeter(provider)
    const headers = response.headers
    const balance = headers.get('x-publik-balance')
    const micros = headers.get('x-publik-balance-micros')
    const value =
      micros !== null
        ? Number(micros)
        : balance !== null
          ? Number(balance) * 1_000_000
          : NaN
    if (Number.isFinite(value)) {
      this.balanceMicros = value
      if (provider.credential)
        // A metadata write failure must not discard a paid model response.
        await this.updateCredential({ balance_micros: value }).catch(() => {})
    }
    for (const [header, field] of [
      ['x-publik-week-usage', 'weekUsage'],
      ['x-publik-week-budget', 'weekBudget'],
      ['x-publik-week-reset', 'weekReset'],
      ['x-publik-charge-micros', 'chargeMicros'],
    ]) {
      const value = headers.get(header)
      if (value !== null && /^[\d.TZ:+\- $]+$/.test(value))
        this.meter[field] = value.slice(0, 100)
    }
  }
  async complete({ userKey, model = 'publik-fast', system, prompt }) {
    if (!TIERS.includes(model))
      throw new Error('Choose publik-fast, publik-balanced, or publik-smart.')
    const provider = await this.resolve(userKey)
    if (provider.kind === 'needs_consent')
      throw new Error(
        'Set up publik API in Settings first, or choose your own API key or a local model.',
      )
    const bodyText = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      max_tokens: 4096,
    })
    if (Buffer.byteLength(bodyText) >= 4 * 1024 * 1024)
      throw new Error(
        'This request exceeds publik’s 4 MB limit. Use a smaller meeting excerpt.',
      )
    const { response, body } = await this.request(
      `${provider.baseURL.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': randomUUID(),
        },
        body: bodyText,
      },
    )
    await this.readMeter(response, provider)
    // Deliberately log only the requested tier, status and metering. No keys or prompts.
    const charge = response.headers.get('x-publik-charge-micros')
    this.log(
      `[publik] app=${APP_SLUG} tier=${model} status=${response.status} charge_micros=${charge && /^\d+$/.test(charge) ? charge : 'unavailable'}`,
    )
    this.notify(await this.status(userKey))
    if (!response.ok)
      throw new PublikError(
        cleanMessage(body.error?.message),
        response.status,
        body.error?.top_up_url,
      )
    const answer = body.choices?.[0]?.message?.content
    if (typeof answer !== 'string' || !answer.trim())
      throw new Error('publik returned no text. Your meeting is unchanged.')
    return answer
  }
}
