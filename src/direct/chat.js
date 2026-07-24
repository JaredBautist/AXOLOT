#!/usr/bin/env node
import { Command } from 'commander'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
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
  .version('0.3.10')
  .argument('[prompt...]', 'prompt text')
  .option('-p, --provider <provider>', 'override provider')
  .option('-m, --model <model>', 'override model')
  .option('--system <prompt>', 'system prompt')
  .option('--yolo', 'skip ALL permission prompts (dangerous — full bypass mode)')
  .option(
    '--dangerously-skip-permissions',
    'skip ALL permission prompts (dangerous — full bypass mode)',
  )
  .action(async (promptParts, options) => {
    const yolo =
      options.yolo ||
      options.dangerouslySkipPermissions ||
      process.env.AXOLOT_YOLO === '1'

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

function buildEngineSpawnConfig({ yolo = false } = {}) {
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

async function launchTui({ yolo = false } = {}) {
  const { bunCommand, args, env, launchDir } = buildEngineSpawnConfig({ yolo })

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
