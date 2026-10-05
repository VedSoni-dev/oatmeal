import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const require = createRequire(import.meta.url)
const unpack = (path) => path.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1')

export function runtimePath(provider) {
  if (provider === 'claude') {
    const root = dirname(
      require.resolve(
        `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`,
      ),
    )
    return unpack(
      join(root, process.platform === 'win32' ? 'claude.exe' : 'claude'),
    )
  }
  const root = dirname(
    require.resolve(
      `@openai/codex-${process.platform}-${process.arch}/package.json`,
    ),
  )
  const cpu = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  const os =
    process.platform === 'darwin'
      ? 'apple-darwin'
      : process.platform === 'win32'
        ? 'pc-windows-msvc'
        : 'unknown-linux-musl'
  return unpack(
    join(
      root,
      'vendor',
      `${cpu}-${os}`,
      'bin',
      process.platform === 'win32' ? 'codex.exe' : 'codex',
    ),
  )
}

function cleanEnvironment() {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/^(OPENAI_|ANTHROPIC_|CLAUDE_|CLAUDECODE|CODEX_|MCP_)/.test(key))
      delete env[key]
  }
  return env
}

export class CodexSubscription {
  constructor(root, emit) {
    this.root = root
    this.emit = emit
    this.pending = new Map()
    this.sequence = 0
    this.turns = new Map()
  }
  async start() {
    if (this.starting) return this.starting
    this.starting = this.initialize().catch((error) => {
      this.starting = null
      throw error
    })
    return this.starting
  }
  async initialize() {
    await mkdir(join(this.root, 'codex'), { recursive: true })
    await mkdir(join(this.root, 'scratch'), { recursive: true })
    this.child = spawn(runtimePath('codex'), ['app-server'], {
      cwd: join(this.root, 'scratch'),
      env: { ...cleanEnvironment(), CODEX_HOME: join(this.root, 'codex') },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child.stderr.on('data', () => {}) // No token-bearing SDK logs in the app console.
    this.child.stdin.on('error', () => {})
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      let message
      try {
        message = JSON.parse(line)
      } catch {
        return
      }
      if (message.method && message.id !== undefined) {
        this.child.stdin.write(
          JSON.stringify({
            id: message.id,
            error: {
              code: -32601,
              message: 'Oatmeal does not permit tools or approval requests.',
            },
          }) + '\n',
        )
      } else if (message.id !== undefined) {
        const pending = this.pending.get(message.id)
        if (pending) {
          clearTimeout(pending.timer)
          this.pending.delete(message.id)
          message.error
            ? pending.reject(
                new Error(
                  'Codex could not complete the request. Check your sign-in and plan access.',
                ),
              )
            : pending.resolve(message.result)
        }
      } else if (message.method === 'account/login/completed') {
        this.emit({
          provider: 'chatgpt',
          success: Boolean(message.params.success),
        })
      } else if (
        message.method === 'item/completed' &&
        message.params.item?.type === 'agentMessage'
      ) {
        const turn = this.turns.get(message.params.threadId)
        if (turn) turn.text = message.params.item.text
      } else if (message.method === 'turn/completed') {
        const turn = this.turns.get(message.params.threadId)
        if (!turn) return
        clearTimeout(turn.timer)
        this.turns.delete(message.params.threadId)
        message.params.turn.status === 'completed' && turn.text
          ? turn.resolve(turn.text)
          : turn.reject(
              new Error(
                'Codex did not finish the summary. Check your plan limits and retry.',
              ),
            )
      }
    })
    const fail = () => {
      this.starting = null
      this.child = null
      for (const task of [...this.pending.values(), ...this.turns.values()]) {
        clearTimeout(task.timer)
        task.reject(new Error('The Codex runtime stopped. Please retry.'))
      }
      this.pending.clear()
      this.turns.clear()
    }
    this.child.on('error', fail)
    this.child.on('exit', fail)
    await this.call('initialize', {
      clientInfo: { name: 'oatmeal', title: 'Oatmeal', version: '2.0.0' },
    })
    this.child.stdin.write(
      JSON.stringify({ method: 'initialized', params: {} }) + '\n',
    )
  }
  call(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.child) {
        reject(new Error('Codex is unavailable'))
        return
      }
      const id = ++this.sequence
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Codex request timed out.'))
      }, 30_000)
      this.pending.set(id, { resolve, reject, timer })
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
    })
  }
  async login() {
    await this.start()
    return this.call('account/login/start', { type: 'chatgpt' })
  }
  async status() {
    await this.start()
    const result = await this.call('account/read', {})
    return {
      connected: result.account?.type === 'chatgpt',
      label: result.account?.email || '',
    }
  }
  async logout() {
    await this.start()
    return this.call('account/logout', {})
  }
  async generate(system, prompt, model) {
    await this.start()
    if (!(await this.status()).connected)
      throw new Error('Connect your ChatGPT subscription in Settings first.')
    const result = await this.call('thread/start', {
      ...(model ? { model } : {}),
      cwd: join(this.root, 'scratch'),
      ephemeral: true,
      sandbox: 'read-only',
      approvalPolicy: 'untrusted',
      baseInstructions: system,
      config: {
        features: { shell_tool: false, apply_patch_freeform: false },
        web_search: 'disabled',
        project_doc_max_bytes: 0,
      },
    })
    const threadId = result.thread.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.turns.delete(threadId)
        this.close()
        reject(new Error('Codex generation timed out.'))
      }, 180_000)
      this.turns.set(threadId, { resolve, reject, timer, text: '' })
      this.call('turn/start', {
        threadId,
        input: [{ type: 'text', text: prompt }],
      }).catch((error) => {
        clearTimeout(timer)
        this.turns.delete(threadId)
        reject(error)
      })
    })
  }
  close() {
    this.child?.kill()
  }
}

export class ClaudeSubscription {
  constructor(root, emit) {
    this.root = root
    this.emit = emit
    this.children = new Set()
    this.generations = new Set()
  }
  async environment() {
    const config = join(this.root, 'claude')
    await mkdir(config, { recursive: true })
    await mkdir(join(this.root, 'scratch'), { recursive: true })
    return { ...cleanEnvironment(), CLAUDE_CONFIG_DIR: config }
  }
  async command(args, timeout = 30_000) {
    const env = await this.environment()
    return new Promise((resolve, reject) => {
      const child = spawn(runtimePath('claude'), args, {
        env,
        cwd: join(this.root, 'scratch'),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      this.children.add(child)
      let output = ''
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('Claude sign-in timed out. Please try again.'))
      }, timeout)
      child.stdout.on('data', (data) => {
        if (output.length < 200_000) output += data
        if (args[1] === 'login') {
          const url = String(data).match(
            /https:\/\/(?:claude\.ai|platform\.claude\.com|console\.anthropic\.com)\/[^\s\u001b]+/,
          )
          if (url)
            this.emit({ provider: 'claude-subscription', authUrl: url[0] })
        }
      })
      child.stderr.on('data', () => {})
      child.on('error', () => {
        clearTimeout(timer)
        this.children.delete(child)
        reject(new Error('The Claude runtime could not start.'))
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        this.children.delete(child)
        code === 0
          ? resolve(output)
          : reject(
              new Error('Claude is not signed in, or sign-in did not finish.'),
            )
      })
    })
  }
  async login() {
    if (this.loggingIn)
      throw new Error(
        'Claude sign-in is already in progress. Finish it in your browser.',
      )
    this.loggingIn = true
    this.command(['auth', 'login', '--claudeai'], 600_000)
      .then(() => this.emit({ provider: 'claude-subscription', success: true }))
      .catch(() =>
        this.emit({ provider: 'claude-subscription', success: false }),
      )
      .finally(() => {
        this.loggingIn = false
      })
    return { pending: true }
  }
  async status() {
    try {
      const result = JSON.parse(
        await this.command(['auth', 'status', '--json']),
      )
      return { connected: Boolean(result.loggedIn), label: result.email || '' }
    } catch {
      return { connected: false, label: '' }
    }
  }
  logout() {
    return this.command(['auth', 'logout'])
  }
  async generate(system, prompt, model) {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const abortController = new AbortController()
    this.generations.add(abortController)
    const timeout = setTimeout(() => abortController.abort(), 180_000)
    try {
      let result = ''
      for await (const message of query({
        prompt,
        options: {
          systemPrompt: system,
          model: model || 'sonnet',
          tools: [],
          mcpServers: {},
          settingSources: [],
          permissionMode: 'dontAsk',
          persistSession: false,
          maxTurns: 1,
          abortController,
          pathToClaudeCodeExecutable: runtimePath('claude'),
          cwd: join(this.root, 'scratch'),
          env: await this.environment(),
          canUseTool: async () => ({
            behavior: 'deny',
            message: 'Oatmeal only generates text.',
          }),
        },
      })) {
        if (message.type === 'result') {
          if (message.is_error)
            throw new Error(
              'Claude could not finish. Check your sign-in and plan limits.',
            )
          result = message.result
        }
      }
      if (!result) throw new Error('Claude returned no summary.')
      return result
    } catch {
      throw new Error(
        'Claude could not generate notes. Check your sign-in, plan limits, and connection.',
      )
    } finally {
      clearTimeout(timeout)
      this.generations.delete(abortController)
    }
  }
  close() {
    for (const controller of this.generations) controller.abort()
    for (const child of this.children) child.kill()
  }
}
