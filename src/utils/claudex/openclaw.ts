import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Conf from 'conf'

export type OpenClawModel = {
  id: string
  provider: string
  input: string
  context: string
  local: boolean
  authenticated: boolean
  tags: string[]
}

export function isClaudexOpenClawMode(): boolean {
  return (
    process.env.CLAUDEX_OPENCLAW_MODE === '1' ||
    process.env.CLAUDEX_NATIVE_MODE === '1'
  )
}

export function isClaudexNativeMode(): boolean {
  return process.env.CLAUDEX_NATIVE_MODE === '1'
}

export function runOpenClaw(args: string[]): {
  ok: boolean
  stdout: string
  stderr: string
} {
  const result = spawnSync('openclaw', args, {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
  })

  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

export function runOpenClawInteractive(args: string[]): { ok: boolean } {
  if (isClaudexNativeMode()) {
    return { ok: false }
  }

  const result = spawnSync('openclaw', args, {
    stdio: 'inherit',
  })

  return {
    ok: result.status === 0,
  }
}

export function getOpenClawConfig(path: string): string {
  try {
    const configPath = join(process.env.HOME ?? '', '.openclaw', 'openclaw.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    const value = path
      .split('.')
      .reduce<unknown>((acc, part) => {
        if (acc && typeof acc === 'object' && part in acc) {
          return (acc as Record<string, unknown>)[part]
        }
        return undefined
      }, config)

    if (
      value !== undefined &&
      value !== null &&
      typeof value !== 'object'
    ) {
      return String(value)
    }
  } catch {
    // Fall back to the CLI.
  }

  try {
    return execFileSync('openclaw', ['config', 'get', path], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

export function getOpenClawPrimaryModel(): string {
  if (isClaudexNativeMode()) {
    return process.env.ANTHROPIC_MODEL || directModelRef()
  }

  const configured = getOpenClawConfig('agents.defaults.model.primary')
  if (configured) return configured

  try {
    const model = execFileSync('openclaw', ['models', 'status', '--plain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split('\n')[0]
      ?.trim()

    if (model) return model
  } catch {
    // Fall through to config.
  }

  return getOpenClawConfig('agents.defaults.model.primary')
}

export function getOpenClawProviderLabel(model: string | null): string {
  if (isClaudexNativeMode()) {
    const id = model || getOpenClawPrimaryModel()
    const provider = id.includes('/') ? id.split('/')[0] : id

    if (id === 'openclaw' || process.env.CLAUDEX_NEEDS_PROVIDER_SETUP === '1') {
      return 'Select your provider and model'
    }
    if (provider === 'openai') return 'OpenAI'
    if (provider === 'gemini' || provider === 'google') return 'Gemini'
    if (provider === 'deepseek') return 'DeepSeek'
    if (provider === 'minimax') return 'MiniMax'
    if (provider === 'claude' || provider === 'anthropic') return 'Claude API'
    return 'Native provider'
  }

  const id = model || getOpenClawPrimaryModel()
  const provider = id.includes('/') ? id.split('/')[0] : ''

  if (!provider) return 'OpenClaw'
  if (provider === 'openai') return 'OpenAI via OpenClaw'
  if (provider === 'openai-codex') return 'OpenAI Codex via OpenClaw'
  if (provider === 'ollama') return 'Ollama via OpenClaw'
  if (provider === 'google' || provider === 'gemini') return 'Gemini via OpenClaw'
  if (provider === 'anthropic') return 'Anthropic via OpenClaw'
  if (provider === 'openrouter') return 'OpenRouter via OpenClaw'

  return `${provider} via OpenClaw`
}

export function listOpenClawModels(): OpenClawModel[] {
  if (isClaudexNativeMode()) {
    const models = [
      directModel('claude', 'claude-3-5-sonnet-latest', 'Claude API'),
      directModel('gemini', 'gemini-2.5-pro', 'Gemini'),
      directModel('gemini', 'gemini-1.5-flash', 'Gemini'),
      directModel('deepseek', 'deepseek-v4-flash', 'DeepSeek V4 Flash'),
      directModel('minimax', 'MiniMax-M3', 'MiniMax M3'),
    ]

    const openaiCredType = directStore.get('credentialType.openai') as string
    if (openaiCredType === 'oauth') {
      models.push(
        directModel('openai', 'gpt-5.5', 'OpenAI (Codex)'),
        directModel('openai', 'gpt-5.4', 'OpenAI (Codex)'),
        directModel('openai', 'gpt-5.4-mini', 'OpenAI (Codex)'),
      )
    }

    return models
  }

  let output = ''
  try {
    output = execFileSync('openclaw', ['models', 'list'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return []
  }

  const rows = output
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('Model '))

  return rows.flatMap(line => {
    const parts = line.split(/\s{2,}/)
    const [id, input = '', context = '', local = '', auth = '', tags = ''] =
      parts
    if (!id || !id.includes('/')) return []

    return [
      {
        id,
        provider: id.split('/')[0] ?? 'unknown',
        input,
        context,
        local: local === 'yes',
        authenticated: auth === 'yes',
        tags: tags
          .split(',')
          .map(tag => tag.trim())
          .filter(Boolean),
      },
    ]
  })
}

export function setOpenClawModel(model: string): {
  ok: boolean
  message: string
} {
  if (isClaudexNativeMode()) {
    setDirectModel(model)
    return { ok: true, message: `Set Claudex model to ${model}` }
  }

  const result = runOpenClaw(['models', 'set', model])
  if (result.ok) {
    return { ok: true, message: `Set OpenClaw model to ${model}` }
  }

  return {
    ok: false,
    message:
      result.stderr.trim() ||
      result.stdout.trim() ||
      `Could not set OpenClaw model to ${model}`,
  }
}

const directStore = new Conf({
  projectName: 'claudex',
  configName: 'direct-providers',
})

function directModel(
  provider: string,
  model: string,
  label: string,
): OpenClawModel {
  const id = `${provider}/${model}`
  return {
    id,
    provider: label,
    input: model,
    context: '',
    local: false,
    authenticated: Boolean(getDirectApiKey(provider)),
    tags: ['native'],
  }
}

function directModelRef(): string {
  const configuredProvider = directStore.get('activeProvider')
  if (!configuredProvider) return 'openclaw'

  const provider = String(configuredProvider)
  const model = String(
    directStore.get(`models.${provider}`) || defaultDirectModel(provider),
  )
  return model.includes('/') ? model : `${provider}/${model}`
}

function setDirectModel(modelRef: string): void {
  const [rawProvider, ...modelParts] = modelRef.split('/')
  const provider = normalizeDirectProvider(rawProvider || 'claude')
  const model = modelParts.join('/') || modelRef

  directStore.set('activeProvider', provider)
  directStore.set(`models.${provider}`, model)
  process.env.CLAUDEX_NATIVE_PROVIDER = provider
  process.env.ANTHROPIC_MODEL = `${provider}/${model}`
}

function normalizeDirectProvider(provider: string): string {
  const value = provider.toLowerCase()
  if (value === 'anthropic') return 'claude'
  if (value === 'google') return 'gemini'
  return value
}

function defaultDirectModel(provider: string): string {
  if (provider === 'openai') return 'gpt-4o-mini'
  if (provider === 'gemini') return 'gemini-2.5-pro'
  if (provider === 'deepseek') return 'deepseek-v4-flash'
  if (provider === 'minimax') return 'MiniMax-M3'
  return 'claude-3-5-sonnet-latest'
}

function getDirectApiKey(provider: string): string {
  const normalized = normalizeDirectProvider(provider)
  if (normalized === 'openai') return process.env.OPENAI_API_KEY || ''
  if (normalized === 'gemini') return process.env.GEMINI_API_KEY || ''
  if (normalized === 'deepseek') return process.env.DEEPSEEK_API_KEY || ''
  if (normalized === 'minimax') return process.env.MINIMAX_API_KEY || ''
  return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || ''
}
