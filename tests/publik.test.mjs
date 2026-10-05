import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  PublikClient,
  DISCLOSURE,
  DEFAULT_BASE_URL,
  balanceLine,
  publikLink,
} from '../desktop/core/publik.mjs'

const setup = async (fetcher, overrides = {}) =>
  new PublikClient({
    path: join(
      await mkdtemp(join(tmpdir(), 'oatmeal-publik-')),
      'oatmeal.json',
    ),
    env: {},
    token: () => 'pat_test_token',
    log: () => {},
    fetcher,
    ...overrides,
  })
const provisionResponse = () =>
  Response.json(
    {
      key: 'pk_test_install',
      base_url: DEFAULT_BASE_URL,
      install_id: 'test-id',
      claim_state: 'anonymous',
      claim_url: 'https://publikhq.com/claim/test',
      balance_micros: 0,
      disclosure: { cost: 'Exact published cost sentence.' },
    },
    { status: 201 },
  )

test('no network on status, no provisioning without consent, one install for concurrent accepts', async () => {
  let requests = 0
  const client = await setup(async (url, options) => {
    requests++
    assert.ok(url.endsWith('/installs'))
    const body = JSON.parse(options.body)
    assert.equal(body.app_slug, 'oatmeal')
    assert.equal(body.disclosure_version, 1)
    return provisionResponse()
  })
  assert.equal((await client.status()).ready, false)
  assert.equal(requests, 0)
  await assert.rejects(client.provision(false), /Accept the publik disclosure/)
  assert.equal(requests, 0)
  const [a, b] = await Promise.all([
    client.provision(true),
    client.provision(true),
  ])
  assert.equal(requests, 1)
  assert.deepEqual(a, b)
  assert.equal(a.disclosure, DISCLOSURE)
  assert.equal(a.cost, 'Exact published cost sentence.')
  assert.match(a.balance, /\$0.00 until linked/)
  assert.ok(!JSON.stringify(a).includes('pk_test'))
  assert.equal(
    JSON.parse(await readFile(client.path, 'utf8')).key,
    'pk_test_install',
  )
  if (process.platform !== 'win32')
    assert.equal((await stat(client.path)).mode & 0o777, 0o600)
  await client.provision(true)
  assert.equal(requests, 1)
})

test('credential precedence: personal key, environment, saved install, then consent', async () => {
  const client = await setup(async () => provisionResponse())
  await client.provision(true)
  assert.equal((await client.resolve()).kind, 'install')
  client.env.PUBLIK_API_KEY = 'pk_environment'
  client.env.PUBLIK_API_BASE_URL = 'https://gateway.example/v1'
  assert.equal((await client.resolve()).kind, 'environment')
  assert.equal((await client.resolve()).baseURL, 'https://gateway.example/v1')
  assert.equal((await client.resolve('pk_own')).kind, 'own')
  assert.equal((await client.resolve('pk_own')).baseURL, DEFAULT_BASE_URL)
})

test('publik sends only tier names, bounds size and logs no keys or prompts', async () => {
  const logs = [],
    events = []
  const client = await setup(
    async (url, options) => {
      assert.equal(options.redirect, 'error')
      assert.equal(options.headers.Authorization, 'Bearer pk_environment')
      const body = JSON.parse(options.body)
      assert.equal(body.model, 'publik-fast')
      return Response.json(
        { choices: [{ message: { content: 'Summary' } }] },
        {
          headers: {
            'x-publik-balance': '0.045',
            'x-publik-charge-micros': '100',
            'x-publik-week-usage': '0.005',
          },
        },
      )
    },
    {
      env: { PUBLIK_API_KEY: 'pk_environment' },
      log: (line) => logs.push(line),
      notify: (status) => events.push(status),
    },
  )
  assert.equal(
    await client.complete({
      system: 'Private system',
      prompt: 'Private transcript',
    }),
    'Summary',
  )
  assert.match(logs[0], /tier=publik-fast status=200 charge_micros=100/)
  assert.doesNotMatch(logs.join(''), /pk_environment|Private/)
  assert.match(events.at(-1).balance, /\$0.04/)
  assert.ok(!JSON.stringify(events).includes('pk_environment'))
  await assert.rejects(
    client.complete({ model: 'gpt-4o', system: '', prompt: '' }),
    /Choose publik/,
  )
  await assert.rejects(
    client.complete({ system: '', prompt: 'a'.repeat(4 * 1024 * 1024) }),
    /4 MB/,
  )
})

test('402 preserves server message and exactly the server action URL', async () => {
  const client = await setup(
    async () =>
      Response.json(
        {
          error: {
            message: 'Link this computer to get started.',
            top_up_url: 'https://publikhq.com/claim/test',
          },
        },
        { status: 402 },
      ),
    { env: { PUBLIK_API_KEY: 'pk_environment' } },
  )
  await assert.rejects(
    client.complete({ system: '', prompt: 'Hello' }),
    (error) =>
      error.status === 402 &&
      error.message === 'Link this computer to get started.' &&
      error.actionUrl === 'https://publikhq.com/claim/test',
  )
  assert.equal(publikLink('javascript:alert(1)'), null)
  assert.equal(publikLink('https://publikhq.com.evil.test/claim'), null)
})

test('wallet refresh stores linked balance; missing app token fails without network', async () => {
  const client = await setup(async (url) =>
    url.endsWith('/installs')
      ? provisionResponse()
      : Response.json({
          balance_micros: 50000,
          claim_state: 'claimed',
          add_credit_url: 'https://publikhq.com/dashboard/api',
        }),
  )
  await client.provision(true)
  const status = await client.wallet()
  assert.equal(status.claimState, 'claimed')
  assert.equal(status.addCreditUrl, 'https://publikhq.com/dashboard/api')
  assert.match(status.balance, /\$0.05/)
  const unavailable = await setup(
    () => {
      throw new Error('Must not call network')
    },
    { token: () => '' },
  )
  assert.equal((await unavailable.status()).available, false)
  await assert.rejects(unavailable.provision(true), /no publik API app token/)
  assert.equal(balanceLine(0, 'claimed'), '$0.00 of publik balance')
})

test('provision replay without a returned key gets one fresh install ID', async () => {
  const ids = []
  const client = await setup(async (_, options) => {
    ids.push(JSON.parse(options.body).install_id)
    return ids.length === 1 ? Response.json({}) : provisionResponse()
  })
  await client.provision(true)
  assert.equal(ids.length, 2)
  assert.notEqual(ids[0], ids[1])
})

test('wallet linking replaces stale anonymous metering and account switches clear it', async () => {
  const client = await setup(async (url) => {
    if (url.endsWith('/installs')) return provisionResponse()
    if (url.endsWith('/wallet'))
      return Response.json(
        { balance_micros: 0, claim_state: 'claimed' },
        { headers: { 'x-publik-balance': '0' } },
      )
    return Response.json(
      { choices: [{ message: { content: 'Done' } }] },
      { headers: { 'x-publik-balance': '0', 'x-publik-charge-micros': '123' } },
    )
  })
  await client.provision(true)
  await client.complete({ system: '', prompt: 'Hello' })
  assert.match((await client.status()).balance, /until linked/)
  assert.equal((await client.wallet()).balance, '$0.00 of publik balance')
  const own = await client.status('pk_another_account')
  assert.equal(own.balance, 'Balance not available yet')
  assert.equal(own.chargeMicros, undefined)
})

test('a failed balance cache write does not discard a successful model response', async () => {
  const client = await setup(async (url) =>
    url.endsWith('/installs')
      ? provisionResponse()
      : Response.json(
          { choices: [{ message: { content: 'Paid response' } }] },
          { headers: { 'x-publik-balance': '0.03' } },
        ),
  )
  await client.provision(true)
  client.updateCredential = async () => {
    throw new Error('Read-only disk')
  }
  assert.equal(
    await client.complete({ system: '', prompt: 'Hello' }),
    'Paid response',
  )
  assert.equal((await client.status()).balance, '$0.03 of publik balance')
})

test('personal and environment wallets retain account links without writing install credentials', async () => {
  for (const source of ['own', 'environment']) {
    const client = await setup(
      async () =>
        Response.json({
          balance_micros: 0,
          claim_state: 'claimed',
          add_credit_url: 'https://publikhq.com/dashboard/api',
        }),
      {
        env:
          source === 'environment' ? { PUBLIK_API_KEY: 'pk_environment' } : {},
      },
    )
    const key = source === 'own' ? 'pk_personal' : undefined
    const status = await client.wallet(key)
    assert.equal(status.source, source)
    assert.equal(status.claimState, 'claimed')
    assert.equal(status.balance, '$0.00 of publik balance')
    assert.equal(status.addCreditUrl, 'https://publikhq.com/dashboard/api')
    assert.equal(await client.readCredential(), null)
    assert.equal((await client.status('pk_different')).addCreditUrl, null)
  }
})
