#!/usr/bin/env node
import { Command } from 'commander'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import {
  getActiveProvider,
  getApiKey,
  getBaseUrl,
  getConfigPath,
  getCredentialType,
  getDefaultModel,
  getProxyConfig,
  hasActiveProvider,
  saveApiKey,
  setActiveProvider,
  setDefaultModel,
} from './config.js'

const PROXY_CLEANUP_KEYS = [
  'ANTHROPIC_API_URL',
  'AXOLOT_OPENCLAW_MODE',
  'UPSTREAM_URL',
  'UPSTREAM_MODEL',
  'UPSTREAM_PROVIDER',
  'UPSTREAM_AUTH',
]

const program = new Command()

program
  .name('axolot')
  .description('Fast direct multi-provider AI CLI')
  .version('0.3.13')
  .argument('[prompt...]', 'prompt text')
  .option('-p, --provider <provider>', 'override provider')
  .option('-m, --model <model>', 'override model')
  .option('--system <prompt>', 'system prompt')
  .option('--yolo', 'skip ALL permission prompts (dangerous — full bypass mode)')
  .option(
    '--dangerously-skip-permissions',
    'skip ALL permission prompts (dangerous — full bypass mode)',
  )
  .option('--sessions', 'show recent session history and exit')
  .option('--all', 'with --sessions: list sessions from every project')
  .action(async (promptParts, options) => {
    const yolo =
      options.yolo ||
      options.dangerouslySkipPermissions ||
      process.env.AXOLOT_YOLO === '1'

    if (options.sessions) {
      printSessions({ all: Boolean(options.all) })
      return
    }

    if (promptParts.length === 0 && process.stdin.isTTY) {
      await launchTui({ yolo })
      return
    }

    // Non-interactive with a prompt: run the FULL agent engine (tools, skills,
    // subagents) in --print mode instead of a raw single-shot completion.
    // The raw completion is still available via `axolot chat "..."`.
    const prompt = await resolvePrompt(promptParts)
    if (!prompt) {
      console.error('Prompt empty. Example: axolot "fix the failing test"')
      process.exitCode = 1
      return
    }
    await runHeadlessAgent(prompt, { yolo })
  })

program
  .command('auth')
  .alias('login')
  .description('Configure a provider API key interactively')
  .argument('[provider]', 'anthropic | openai | gemini | deepseek | minimax')
  .action(async providerArg => {
    const rl = readline.createInterface({ input, output })
    try {
      const provider =
        providerArg ||
        (await rl.question('Provider (anthropic/openai/gemini/deepseek/minimax): ')).trim()
      const apiKey = (await rl.question('API key: ')).trim()

      saveApiKey(provider, apiKey)
      setActiveProvider(provider)
      console.log(`Provider configured: ${getActiveProvider()}`)
      console.log(`Config: ${getConfigPath()}`)
    } finally {
      rl.close()
    }
  })

program
  .command('key')
  .description('Save an API key locally')
  .argument('<provider>', 'anthropic | openai | gemini | deepseek | minimax')
  .argument('<apiKey>', 'provider API key')
  .action((provider, apiKey) => {
    saveApiKey(provider, apiKey)
    console.log(`API key saved for ${provider}`)
    console.log(`Config: ${getConfigPath()}`)
  })

program
  .command('use')
  .description('Set active provider and optional default model')
  .argument('<provider>', 'anthropic | openai | gemini | deepseek | minimax')
  .argument('[model]', 'default model for this provider')
  .action((provider, model) => {
    setActiveProvider(provider)
    if (model) setDefaultModel(provider, model)
    console.log(`Active provider: ${getActiveProvider()}`)
    console.log(`Default model: ${getDefaultModel()}`)
  })

program
  .command('sessions')
  .alias('history')
  .description('List recent Axolot sessions (most recent first)')
  .option('-a, --all', 'list sessions from every project, not just this folder')
  .option('-n, --limit <n>', 'max number of sessions to show', '20')
  .action(options => {
    const limit = Number.parseInt(options.limit, 10)
    printSessions({
      all: Boolean(options.all),
      limit: Number.isFinite(limit) && limit > 0 ? limit : 20,
    })
  })

program
  .command('resume')
  .description('Resume a previous session (opens a picker if no id is given)')
  .argument('[id]', 'session id (see `axolot sessions`), or search term')
  .option('--yolo', 'skip ALL permission prompts (dangerous — full bypass mode)')
  .action(async (id, options) => {
    const yolo = options.yolo || process.env.AXOLOT_YOLO === '1'
    // `--resume` with no value opens the engine's interactive picker; with an
    // id it jumps straight into that conversation.
    const engineArgs = id ? ['--resume', id] : ['--resume']
    await launchTui({ yolo, engineArgs })
  })

program
  .command('continue')
  .description('Continue the most recent session in this folder')
  .option('--yolo', 'skip ALL permission prompts (dangerous — full bypass mode)')
  .action(async options => {
    const yolo = options.yolo || process.env.AXOLOT_YOLO === '1'
    await launchTui({ yolo, engineArgs: ['--continue'] })
  })

program
  .command('chat')
  .description('Send a prompt using native SDK streaming')
  .argument('[prompt...]', 'prompt text')
  .option('-p, --provider <provider>', 'override provider')
  .option('-m, --model <model>', 'override model')
  .option('--system <prompt>', 'system prompt')
  .action(runChat)

program.parseAsync(process.argv).catch(error => {
  console.error(`Fatal error: ${formatError(error)}`)
  process.exitCode = 1
})

async function resolvePrompt(promptParts) {
  const inline = promptParts.join(' ').trim()
  if (inline) return inline

  if (!process.stdin.isTTY) {
    return await readStdin()
  }

  const rl = readline.createInterface({ input, output })
  try {
    return (await rl.question('You: ')).trim()
  } finally {
    rl.close()
  }
}

async function runChat(promptParts, options) {
  const globalOptions = options.parent?.opts?.() || {}
  const providerName =
    options.provider || globalOptions.provider || getActiveProvider()
  const model =
    options.model || globalOptions.model || getDefaultModel(providerName)
  const systemPrompt = options.system || globalOptions.system
  const apiKey = getApiKey(providerName)

  if (!apiKey) {
    console.error(
      `No API key configured for ${providerName}. Run:\n` +
        `  axolot auth ${providerName}\n` +
        `or set the matching env var.`,
    )
    process.exitCode = 1
    return
  }

  const prompt = await resolvePrompt(promptParts)
  if (!prompt) {
    console.error('Prompt empty. Example: axolot chat "hello"')
    process.exitCode = 1
    return
  }

  const abortController = new AbortController()
  const stop = () => {
    abortController.abort()
    process.stderr.write('\nRequest cancelled.\n')
  }

  process.once('SIGINT', stop)

  try {
    const { createProvider } = await import('./providers.js')
    const provider = createProvider(providerName, { apiKey })

    // Modelos con razonamiento (DeepSeek, NVIDIA NIM, MiniMax...) emiten el
    // thinking antes que la respuesta; mostrarlo atenuado por stderr para que
    // no parezca que el CLI está colgado (stdout queda limpio para pipes).
    // Ocultable con AXOLOT_HIDE_THINKING=1.
    const showThinking =
      process.stderr.isTTY && process.env.AXOLOT_HIDE_THINKING !== '1'
    let sawThinking = false
    let contentStarted = false

    await provider.streamResponse(
      prompt,
      model,
      chunk => {
        if (sawThinking && !contentStarted) {
          contentStarted = true
          process.stderr.write('\n\n')
        }
        process.stdout.write(chunk)
      },
      {
        signal: abortController.signal,
        system: systemPrompt,
        onThinking: showThinking
          ? text => {
              sawThinking = true
              process.stderr.write(`\x1b[2m${text}\x1b[0m`)
            }
          : undefined,
      },
    )
    process.stdout.write('\n')
  } catch (error) {
    if (abortController.signal.aborted) return
    console.error(`\nProvider error: ${formatError(error)}`)
    process.exitCode = 1
  } finally {
    process.removeListener('SIGINT', stop)
  }
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8').trim()
}

function formatError(error) {
  if (error?.name === 'AbortError') return 'request aborted'
  if (error?.message) return error.message
  return String(error)
}

function buildEngineSpawnConfig({ yolo = false, engineArgs = [] } = {}) {
  const providerName = hasActiveProvider() ? getActiveProvider() : null
  const model = providerName ? getDefaultModel(providerName) : null
  const apiKey = providerName ? getApiKey(providerName) : ''
  const shouldSelectProvider = !providerName || !apiKey

  const thisFile = fileURLToPath(import.meta.url)
  const repoRoot = resolve(dirname(thisFile), '..', '..')
  const launchDir = process.cwd()
  const skillsPackDir = resolve(repoRoot, 'skillpacks', 'token-lean')
  const runtimeConfigDir = getRuntimeConfigDir()
  const settingsPath = resolve(runtimeConfigDir, 'settings.json')

  mkdirSync(runtimeConfigDir, { recursive: true })
  if (!existsSync(settingsPath)) {
    writeFileSync(settingsPath, '{}\n')
  }

  const env = {
    ...process.env,
    CLAUDE_CODE_DISABLE_AUTO_UPDATE: '1',
    CLAUDE_CODE_ASSUME_TTY: '1',
    CLAUDE_CODE_SKIP_BOOTSTRAP: '0',
    CLAUDE_CODE_OFFLINE_MODE: '0',
    CLAUDE_CONFIG_DIR: runtimeConfigDir,
    CLAUDE_CODE_TRUSTED_ROOT: launchDir,
  }

  if (shouldSelectProvider) {
    env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY || 'axolot-native-provider'
    env.AXOLOT_NATIVE_MODE = '1'
    env.AXOLOT_NATIVE_PROVIDER = ''
    env.AXOLOT_NEEDS_PROVIDER_SETUP = '1'
    env.ANTHROPIC_MODEL = 'openclaw'
  } else if (providerName === 'claude') {
    if (getCredentialType(providerName) === 'oauth') {
      env.ANTHROPIC_AUTH_TOKEN = apiKey
    } else {
      env.ANTHROPIC_API_KEY = apiKey
    }
    if (model) {
      env.ANTHROPIC_MODEL = model
    }
  } else {
    env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY || 'axolot-native-provider'
    env.AXOLOT_NATIVE_PROVIDER = providerName
    env.AXOLOT_NATIVE_MODE = '1'
    env.ANTHROPIC_MODEL = modelRefForProvider(providerName, model)
    if (providerName === 'openai') {
      env.OPENAI_API_KEY = apiKey
    }
    if (providerName === 'gemini') {
      env.GEMINI_API_KEY = apiKey
    }
    if (providerName === 'minimax') {
      env.MINIMAX_API_KEY = apiKey
    }
  }

  // Si hay proxy configurado para claude, preservamos sus env vars
  const hasProxy = providerName === 'claude' && getProxyConfig('claude')
  if (hasProxy) {
    const proxyCfg = getProxyConfig('claude')
    env.ANTHROPIC_BASE_URL = proxyCfg.baseURL
    if (proxyCfg.authToken) {
      env.ANTHROPIC_API_KEY = proxyCfg.authToken
    }
  } else {
    // Sin proxy: respetar la base URL custom del usuario para Claude
    // (env var o configurada via /model). Para providers nativos se limpia —
    // el motor habla con Anthropic solo como passthrough.
    const customBase = providerName === 'claude' ? getBaseUrl('claude') : ''
    if (customBase) {
      env.ANTHROPIC_BASE_URL = customBase
    } else {
      delete env.ANTHROPIC_BASE_URL
    }
  }
  for (const key of PROXY_CLEANUP_KEYS) {
    delete env[key]
  }

  // Permission model: normal approval flow by default (like Claude Code).
  // Full bypass only with explicit opt-in (--yolo / AXOLOT_YOLO=1).
  const permissionArgs = yolo
    ? [
        '--dangerously-skip-permissions',
        '--allow-dangerously-skip-permissions',
        '--permission-mode',
        'bypassPermissions',
      ]
    : []
  if (yolo) {
    env.AXOLOT_YOLO = '1'
  }

  const args = [
    'run',
    resolve(repoRoot, 'src/dev-entry.ts'),
    ...permissionArgs,
    // Session resume/continue flags (--resume [id], --continue) forwarded to
    // the engine, which owns the transcript store and the interactive picker.
    ...engineArgs,
    '--add-dir',
    launchDir,
    '--add-dir',
    repoRoot,
    '--add-dir',
    resolve(repoRoot, 'src'),
    '--add-dir',
    skillsPackDir,
    '--settings',
    settingsPath,
  ]

  return {
    bunCommand: resolveBundledBun(repoRoot),
    args,
    env,
    launchDir,
  }
}

async function launchTui({ yolo = false, engineArgs = [] } = {}) {
  const { bunCommand, args, env, launchDir } = buildEngineSpawnConfig({
    yolo,
    engineArgs,
  })

  const result = spawnSync(bunCommand, args, {
    cwd: launchDir,
    env,
    stdio: 'inherit',
  })

  if (result.error) {
    console.error(`No pude abrir la TUI: ${formatError(result.error)}`)
    process.exitCode = 1
    return
  }

  process.exitCode = result.status ?? 0
}

async function runHeadlessAgent(prompt, { yolo = false } = {}) {
  const { bunCommand, args, env, launchDir } = buildEngineSpawnConfig({ yolo })
  env.CLAUDE_CODE_ASSUME_TTY = '0'

  // Non-interactive runs can't answer permission prompts. Without --yolo,
  // auto-accept file edits but let anything riskier be denied by policy.
  const headlessArgs = [
    ...args,
    ...(yolo ? [] : ['--permission-mode', 'acceptEdits']),
    '--print',
    prompt,
  ]

  const result = spawnSync(bunCommand, headlessArgs, {
    cwd: launchDir,
    env,
    stdio: 'inherit',
  })

  if (result.error) {
    console.error(`No pude ejecutar el agente: ${formatError(result.error)}`)
    process.exitCode = 1
    return
  }

  process.exitCode = result.status ?? 0
}

function resolveBundledBun(repoRoot) {
  const localBin = resolve(
    repoRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'bun.cmd' : 'bun',
  )

  if (existsSync(localBin)) return localBin
  return 'bun'
}

function getRuntimeConfigDir() {
  const configRoot =
    process.env.XDG_CONFIG_HOME || resolve(homedir(), '.config')
  return resolve(configRoot, 'axolot', 'axolot-runtime')
}

// Mirror the engine's transcript layout: sessions live as JSONL files under
// <runtimeConfigDir>/projects/<sanitized-cwd>/<sessionId>.jsonl. The engine
// sanitizes a directory path by replacing every non-alphanumeric char with '-'
// (see sanitizePath in sessionStoragePortable.ts) — replicate that here so we
// can map the current folder back to its project directory.
function sanitizeProjectPath(dir) {
  return String(dir).replace(/[^a-zA-Z0-9]/g, '-')
}

function getProjectsRoot() {
  return resolve(getRuntimeConfigDir(), 'projects')
}

// Pull a human-friendly title from a transcript: the first genuine user message,
// skipping the meta/command/caveat noise the TUI injects at the top.
function readSessionMeta(filePath) {
  let raw = ''
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
  const lines = raw.split('\n').filter(Boolean)
  let title = ''
  let cwd = ''
  let messages = 0
  let sessionId = ''

  for (const line of lines) {
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (!sessionId && entry.sessionId) sessionId = entry.sessionId
    if (!cwd && entry.cwd) cwd = entry.cwd
    if (entry.type === 'user' || entry.type === 'assistant') messages += 1

    if (!title && entry.type === 'user' && !entry.isMeta && entry.message) {
      let content = entry.message.content
      if (Array.isArray(content)) {
        content = content
          .map(part => (typeof part === 'string' ? part : part?.text || ''))
          .join(' ')
      }
      content = String(content || '').replace(/\s+/g, ' ').trim()
      const noise =
        content.startsWith('<local-command') ||
        content.startsWith('<command-name') ||
        content.startsWith('<command-message') ||
        content.startsWith('<command-args') ||
        content.startsWith('Caveat:')
      if (content && !noise) title = content
    }
  }

  return { title, cwd, messages, sessionId }
}

// "2m ago", "3h ago", "yesterday", "5d ago", or a date for older sessions.
function formatRelativeTime(then, now) {
  const diff = Math.max(0, now - then)
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(then).toISOString().slice(0, 10)
}

function collectSessions({ all }) {
  const root = getProjectsRoot()
  if (!existsSync(root)) return []

  const currentProject = sanitizeProjectPath(process.cwd())
  let projectDirs
  try {
    projectDirs = readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
  } catch {
    return []
  }

  if (!all) {
    projectDirs = projectDirs.filter(name => name === currentProject)
  }

  const sessions = []
  for (const name of projectDirs) {
    const dir = resolve(root, name)
    let files
    try {
      files = readdirSync(dir).filter(f => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const file of files) {
      const filePath = resolve(dir, file)
      let stat
      try {
        stat = statSync(filePath)
      } catch {
        continue
      }
      if (!stat.size) continue
      const meta = readSessionMeta(filePath)
      if (!meta || meta.messages === 0) continue
      sessions.push({
        mtime: stat.mtimeMs,
        id: meta.sessionId || file.replace(/\.jsonl$/, ''),
        title: meta.title || '(no messages)',
        cwd: meta.cwd || '',
        messages: meta.messages,
      })
    }
  }

  sessions.sort((a, b) => b.mtime - a.mtime)
  return sessions
}

function printSessions({ all = false, limit = 20 } = {}) {
  const now = Date.now()
  const sessions = collectSessions({ all })

  if (sessions.length === 0) {
    if (all) {
      console.log('No sessions found yet. Start one with: axolot')
    } else {
      console.log('No sessions found in this folder.')
      console.log('Tip: run `axolot sessions --all` to see every project.')
    }
    return
  }

  const shown = sessions.slice(0, limit)
  const scope = all ? 'all projects' : process.cwd()
  console.log('')
  console.log(`  Recent Axolot sessions — ${scope}`)
  console.log('')

  shown.forEach((s, i) => {
    const num = String(i + 1).padStart(2, ' ')
    const when = formatRelativeTime(s.mtime, now).padEnd(12, ' ')
    const count = `${s.messages} msg`.padStart(7, ' ')
    const title = s.title.length > 60 ? `${s.title.slice(0, 59)}…` : s.title
    console.log(`  ${num}  ${when}  ${count}  ${title}`)
    if (all && s.cwd) console.log(`      ${s.cwd}`)
    console.log(`      id: ${s.id}`)
  })

  console.log('')
  if (sessions.length > shown.length) {
    console.log(
      `  … ${sessions.length - shown.length} more. Use --limit <n> to show more.`,
    )
  }
  console.log('  Resume one with:  axolot resume <id>')
  console.log('  Or continue the latest:  axolot continue')
  console.log('')
}

async function promptForApiKey(provider) {
  const rl = readline.createInterface({ input, output })
  try {
    return (await rl.question(`${provider} API key: `)).trim()
  } finally {
    rl.close()
  }
}

function modelRefForProvider(provider, model) {
  const value = String(model || '').trim()
  if (!value) return provider
  // Model IDs can themselves contain slashes (e.g. NVIDIA NIM's
  // "deepseek-ai/deepseek-v4-pro"), so only skip prefixing when the ref
  // already starts with the provider segment.
  if (value.startsWith(`${provider}/`)) return value
  return `${provider}/${value}`
}
