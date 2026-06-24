import Conf from 'conf'

export const PROVIDERS = Object.freeze(['claude', 'openai', 'gemini', 'deepseek', 'minimax'])
const DISPLAY_PROVIDERS = Object.freeze(['anthropic', 'openai', 'gemini', 'deepseek', 'minimax'])

const DEFAULT_MODELS = Object.freeze({
  claude: 'claude-3-5-sonnet-latest',
  openai: 'gpt-5.5',
  gemini: 'gemini-2.5-pro',
  deepseek: 'deepseek-v4-flash',
  minimax: 'MiniMax-M3',
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

  throw new Error(
    `Proveedor no soportado: ${provider}. Usa: ${DISPLAY_PROVIDERS.join(', ')}`,
  )
}

export function saveApiKey(provider, apiKey) {
  const normalized = normalizeProvider(provider)
  const key = String(apiKey || '').trim()

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

  return (
    process.env[envKeyForProvider(normalized)] ||
    process.env[authTokenEnvKey(normalized)] ||
    store.get(`apiKeys.${normalized}`) ||
    ''
  )
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
  if (!proxy || !proxy.baseURL) return

  process.env.ANTHROPIC_BASE_URL = proxy.baseURL
  if (proxy.authToken) {
    process.env.ANTHROPIC_AUTH_TOKEN = proxy.authToken
  }
  if (proxy.models?.opus) {
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = proxy.models.opus
  }
  if (proxy.models?.sonnet) {
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = proxy.models.sonnet
  }
  if (proxy.models?.haiku) {
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = proxy.models.haiku
  }
}

export function getConfigPath() {
  return store.path
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
