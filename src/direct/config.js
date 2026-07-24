import Conf from 'conf'

export const PROVIDERS = Object.freeze(['claude', 'openai', 'gemini', 'deepseek', 'minimax', 'glm', 'kimi'])
const DISPLAY_PROVIDERS = Object.freeze(['anthropic', 'openai', 'gemini', 'deepseek', 'minimax', 'glm', 'kimi'])

// Providers hosted behind NVIDIA NIM's universal OpenAI-compatible endpoint.
// A single NVIDIA_API_KEY unlocks all of them, so it's a shared fallback key.
const NVIDIA_HOSTED = Object.freeze(['glm', 'kimi', 'deepseek'])
export const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1'

const DEFAULT_MODELS = Object.freeze({
  claude: 'claude-3-5-sonnet-latest',
  openai: 'gpt-5.5',
  gemini: 'gemini-2.5-pro',
  deepseek: 'deepseek-v4-flash',
  minimax: 'MiniMax-M3',
  glm: 'z-ai/glm-4.6',
  kimi: 'moonshotai/kimi-k2-instruct',
})

const store = new Conf({
  projectName: 'axolot',
  configName: 'direct-providers',
  defaults: {
    models: DEFAULT_MODELS,
    apiKeys: {},
  },
})

export function normalizeProvider(provider) {
  const value = String(provider || '').trim().toLowerCase()

  if (value === 'anthropic' || value === 'claude') return 'claude'
  if (value === 'chatgpt' || value === 'gpt' || value === 'openai') {
    return 'openai'
  }
  if (value === 'google' || value === 'gemini') return 'gemini'
  if (value === 'deepseek') return 'deepseek'
  if (value === 'minimax') return 'minimax'
  if (value === 'glm' || value === 'zhipu' || value === 'zai' || value === 'z-ai') {
    return 'glm'
  }
  if (value === 'kimi' || value === 'moonshot' || value === 'moonshotai') {
    return 'kimi'
  }

  throw new Error(
    `Proveedor no soportado: ${provider}. Usa: ${DISPLAY_PROVIDERS.join(', ')}`,
  )
}

export function saveApiKey(provider, apiKey) {
  const normalized = normalizeProvider(provider)
  // Keep only visible ASCII, not just trim edges: a newline/zero-width char from
  // a wrapped paste survives .trim() and later breaks the Authorization header.
  const key = String(apiKey || '').replace(/[^\x21-\x7E]/g, '')

  if (!key) {
    throw new Error(`API key vacia para ${normalized}`)
  }

  store.set(`apiKeys.${normalized}`, key)
  store.set(`credentialType.${normalized}`, 'apikey')
}

export function saveOAuthToken(provider, token) {
  const normalized = normalizeProvider(provider)
  const value = String(token || '').trim()

  if (!value) {
    throw new Error(`OAuth token vacio para ${normalized}`)
  }

  store.set(`apiKeys.${normalized}`, value)
  store.set(`credentialType.${normalized}`, 'oauth')
}

export function saveRefreshToken(provider, token) {
  const normalized = normalizeProvider(provider)
  const value = String(token || '').trim()
  if (value) {
    store.set(`refreshTokens.${normalized}`, value)
  }
}

export function getRefreshToken(provider = getActiveProvider()) {
  const normalized = normalizeProvider(provider)
  return store.get(`refreshTokens.${normalized}`) || ''
}

export function getCredentialType(provider = getActiveProvider()) {
  const normalized = normalizeProvider(provider)
  return store.get(`credentialType.${normalized}`) || 'apikey'
}

export function getApiKey(provider = getActiveProvider()) {
  const normalized = normalizeProvider(provider)

  const raw =
    process.env[envKeyForProvider(normalized)] ||
    process.env[authTokenEnvKey(normalized)] ||
    store.get(`apiKeys.${normalized}`) ||
    // Shared NVIDIA key: one nvapi- key unlocks every NVIDIA-hosted provider, so
    // fall back to it (env, then any sibling's stored key) — "add the key once".
    (NVIDIA_HOSTED.includes(normalized) ? sharedNvidiaKey() : '') ||
    ''
  // Sanitize on read too: env vars often carry a trailing newline, which is an
  // invalid character in the Authorization header value. Keep only visible ASCII.
  return String(raw).replace(/[^\x21-\x7E]/g, '')
}

export function clearCredentials(provider) {
  const normalized = normalizeProvider(provider)
  store.delete(`apiKeys.${normalized}`)
  store.delete(`credentialType.${normalized}`)
  store.delete(`refreshTokens.${normalized}`)
}

export function setActiveProvider(provider) {
  const normalized = normalizeProvider(provider)
  store.set('activeProvider', normalized)
}

export function getActiveProvider() {
  return normalizeProvider(store.get('activeProvider') || 'claude')
}

export function hasActiveProvider() {
  return Boolean(store.get('activeProvider'))
}

export function setDefaultModel(provider, model) {
  const normalized = normalizeProvider(provider)
  const value = String(model || '').trim()

  if (!value) {
    throw new Error(`Modelo vacio para ${normalized}`)
  }

  store.set(`models.${normalized}`, value)
}

export function getDefaultModel(provider = getActiveProvider()) {
  const normalized = normalizeProvider(provider)

  return store.get(`models.${normalized}`) || DEFAULT_MODELS[normalized]
}

export function saveBaseUrl(provider, baseUrl) {
  const normalized = normalizeProvider(provider)
  let value = String(baseUrl || '').trim()

  if (!value) {
    clearBaseUrl(normalized)
    return
  }
  // Aceptar hosts sin esquema ("integrate.api.nvidia.com/v1") — https por defecto.
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`
  }
  value = value.replace(/\/+$/, '')
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    parsed = null
  }
  // new URL() es muy permisivo (percent-encodea espacios, etc.) — exigir un
  // hostname real y sin espacios para no guardar basura que fallará en fetch.
  if (!parsed || !parsed.hostname || /\s/.test(value)) {
    throw new Error(`Base URL invalida para ${normalized}: ${baseUrl}`)
  }

  store.set(`baseUrls.${normalized}`, value)
}

export function getBaseUrl(provider = getActiveProvider()) {
  const normalized = normalizeProvider(provider)

  return (
    process.env[baseUrlEnvKey(normalized)] ||
    store.get(`baseUrls.${normalized}`) ||
    ''
  )
}

export function clearBaseUrl(provider) {
  const normalized = normalizeProvider(provider)
  store.delete(`baseUrls.${normalized}`)
}

export function saveProxyConfig(provider, baseURL, authToken, modelOverrides = {}) {
  const normalized = normalizeProvider(provider)
  store.set(`proxy.${normalized}`, {
    baseURL: String(baseURL || '').trim(),
    authToken: String(authToken || '').trim(),
    models: modelOverrides,
  })
}

export function getProxyConfig(provider) {
  const normalized = normalizeProvider(provider)
  return store.get(`proxy.${normalized}`) || null
}

export function clearProxyConfig(provider) {
  const normalized = normalizeProvider(provider)
  store.delete(`proxy.${normalized}`)
}

export function applyProxyEnv(provider) {
  const proxy = getProxyConfig(provider)
  if (!proxy || !proxy.baseURL) {
    // If a previous call in this process applied proxy env, undo exactly what
    // it set — otherwise model overrides and base URL stick after the user
    // disables the proxy. Vars the user set themselves are left alone.
    const managed = (process.env.AXOLOT_PROXY_MANAGED || '').split(',').filter(Boolean)
    for (const key of managed) {
      delete process.env[key]
    }
    delete process.env.AXOLOT_PROXY_MANAGED
    delete process.env.AXOLOT_PROXY_ACTIVE

    // No proxy: fall back to a user-configured base URL for Anthropic
    // (set via /model → "Set custom base URL"). The Anthropic SDK reads
    // ANTHROPIC_BASE_URL from the environment.
    const storedBase = store.get('baseUrls.claude')
    if (storedBase && !process.env.ANTHROPIC_BASE_URL) {
      process.env.ANTHROPIC_BASE_URL = storedBase
    }
    return
  }

  const managed = ['ANTHROPIC_BASE_URL']
  process.env.AXOLOT_PROXY_ACTIVE = '1'
  process.env.ANTHROPIC_BASE_URL = proxy.baseURL
  if (proxy.authToken) {
    process.env.ANTHROPIC_API_KEY = proxy.authToken
    delete process.env.ANTHROPIC_AUTH_TOKEN
    managed.push('ANTHROPIC_API_KEY')
  }
  if (proxy.models?.opus) {
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = proxy.models.opus
    managed.push('ANTHROPIC_DEFAULT_OPUS_MODEL')
  }
  if (proxy.models?.sonnet) {
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = proxy.models.sonnet
    managed.push('ANTHROPIC_DEFAULT_SONNET_MODEL')
  }
  if (proxy.models?.haiku) {
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = proxy.models.haiku
    managed.push('ANTHROPIC_DEFAULT_HAIKU_MODEL')
  }
  process.env.AXOLOT_PROXY_MANAGED = managed.join(',')
}

export function getConfigPath() {
  return store.path
}

// The NVIDIA key shared across NVIDIA-hosted providers: prefer the explicit
// NVIDIA_API_KEY env, else reuse whatever key the user already stored for any
// sibling provider (deepseek/glm/kimi) so a single paste enables them all.
function sharedNvidiaKey() {
  const env = process.env.NVIDIA_API_KEY
  if (env) return env
  for (const p of NVIDIA_HOSTED) {
    const stored = store.get(`apiKeys.${p}`)
    if (stored) return stored
  }
  return ''
}

function envKeyForProvider(provider) {
  switch (provider) {
    case 'claude':
      return 'ANTHROPIC_API_KEY'
    case 'openai':
      return 'OPENAI_API_KEY'
    case 'gemini':
      return 'GEMINI_API_KEY'
    case 'deepseek':
      return 'DEEPSEEK_API_KEY'
    case 'minimax':
      return 'MINIMAX_API_KEY'
    case 'glm':
      return 'GLM_API_KEY'
    case 'kimi':
      return 'KIMI_API_KEY'
    default:
      return ''
  }
}

function baseUrlEnvKey(provider) {
  switch (provider) {
    case 'claude':
      return 'ANTHROPIC_BASE_URL'
    case 'openai':
      return 'OPENAI_BASE_URL'
    case 'gemini':
      return 'GEMINI_BASE_URL'
    case 'deepseek':
      return 'DEEPSEEK_BASE_URL'
    case 'minimax':
      return 'MINIMAX_BASE_URL'
    case 'glm':
      return 'GLM_BASE_URL'
    case 'kimi':
      return 'KIMI_BASE_URL'
    default:
      return ''
  }
}

function authTokenEnvKey(provider) {
  switch (provider) {
    case 'claude':
      return 'ANTHROPIC_AUTH_TOKEN'
    default:
      return ''
  }
}
