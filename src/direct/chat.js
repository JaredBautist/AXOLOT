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
  getConfigPath,
  getCredentialType,
  getDefaultModel,
  hasActiveProvider,
  saveApiKey,
  setActiveProvider,
  setDefaultModel,
} from './config.js'

const program = new Command()

program
  .name('claudex')
  .description('Fast direct multi-provider AI CLI')
  .version('0.1.2')
  .argument('[prompt...]', 'prompt text')
  .option('-p, --provider <provider>', 'override provider')
  .option('-m, --model <model>', 'override model')
  .option('--system <prompt>', 'system prompt')
  .action(async (promptParts, options) => {
    if (promptParts.length === 0 && process.stdin.isTTY) {
      await launchTui()
      return
    }

    await runChat(promptParts, options)
  })

program
  .command('auth')
  .alias('login')
  .description('Configure a provider API key interactively')
  .argument('[provider]', 'claude | openai | gemini')
  .action(async providerArg => {
    const rl = readline.createInterface({ input, output })
    try {
      const provider =
        providerArg ||
        (await rl.question('Provider (claude/openai/gemini): ')).trim()
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
  .argument('<provider>', 'claude | openai | gemini')
  .argument('<apiKey>', 'provider API key')
  .action((provider, apiKey) => {
    saveApiKey(provider, apiKey)
    console.log(`API key saved for ${provider}`)
    console.log(`Config: ${getConfigPath()}`)
  })

program
  .command('use')
  .description('Set active provider and optional default model')
  .argument('<provider>', 'claude | openai | gemini')
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
        `  claudex auth ${providerName}\n` +
        `or set the matching env var.`,
    )
    process.exitCode = 1
    return
  }

  const prompt = await resolvePrompt(promptParts)
  if (!prompt) {
    console.error('Prompt empty. Example: claudex chat "hello"')
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
    await provider.streamResponse(
      prompt,
      model,
      chunk => process.stdout.write(chunk),
      {
        signal: abortController.signal,
        system: systemPrompt,
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

async function launchTui() {
  const providerName = hasActiveProvider() ? getActiveProvider() : null
  const model = providerName ? getDefaultModel(providerName) : null
  const apiKey = providerName ? getApiKey(providerName) : ''
  const shouldSelectProvider = !providerName || !apiKey

  const thisFile = fileURLToPath(import.meta.url)
  const repoRoot = resolve(dirname(thisFile), '..', '..')
  const launchDir = process.cwd()
  const skillsPackDir = resolve(repoRoot, 'skillpacks', 'token-lean')
  const claudeConfigDir = getRuntimeConfigDir()
  const settingsPath = resolve(claudeConfigDir, 'settings.json')

  mkdirSync(claudeConfigDir, { recursive: true })
  if (!existsSync(settingsPath)) {
    writeFileSync(settingsPath, '{}\n')
  }

  const env = {
    ...process.env,
    CLAUDE_CODE_DISABLE_AUTO_UPDATE: '1',
    CLAUDE_CODE_ASSUME_TTY: '1',
    CLAUDE_CODE_SKIP_BOOTSTRAP: '0',
    CLAUDE_CODE_OFFLINE_MODE: '0',
    CLAUDE_CONFIG_DIR: claudeConfigDir,
    CLAUDE_CODE_TRUSTED_ROOT: launchDir,
  }

  if (shouldSelectProvider) {
    env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY || 'claudex-native-provider'
    env.CLAUDEX_NATIVE_MODE = '1'
    env.CLAUDEX_NATIVE_PROVIDER = ''
    env.CLAUDEX_NEEDS_PROVIDER_SETUP = '1'
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
    env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY || 'claudex-native-provider'
    env.CLAUDEX_NATIVE_PROVIDER = providerName
    env.CLAUDEX_NATIVE_MODE = '1'
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

  delete env.ANTHROPIC_API_URL
  delete env.ANTHROPIC_BASE_URL
  delete env.CLAUDEX_OPENCLAW_MODE
  delete env.UPSTREAM_URL
  delete env.UPSTREAM_MODEL
  delete env.UPSTREAM_PROVIDER
  delete env.UPSTREAM_AUTH

  const args = [
    'run',
    resolve(repoRoot, 'src/dev-entry.ts'),
    '--dangerously-skip-permissions',
    '--allow-dangerously-skip-permissions',
    '--permission-mode',
    'bypassPermissions',
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

  const bunCommand = resolveBundledBun(repoRoot)
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
  return resolve(configRoot, 'claudex', 'claude-runtime')
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
  if (value.includes('/')) return value
  return `${provider}/${value}`
}
