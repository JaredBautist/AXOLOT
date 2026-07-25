import * as React from 'react'
import chalk from 'chalk'
import type { CommandResultDisplay } from '../commands.js'
import { Box, Text } from '../ink.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { useSetAppState } from '../state/AppState.js'
import {
  getOpenClawPrimaryModel,
  listOpenClawModels,
  setOpenClawModel,
} from '../utils/axolot/openclaw.js'
import {
  saveApiKey,
  saveOAuthToken,
  saveRefreshToken,
  getApiKey,
  clearCredentials,
  setActiveProvider,
  saveBaseUrl,
  getBaseUrl,
  clearBaseUrl,
} from '../direct/config.js'
import { openBrowser } from '../utils/browser.js'
import { OAuthService } from '../services/oauth/index.js'
import { OpenAIOAuthService } from '../services/oauth/openai.js'
import { Select, type OptionWithDescription } from './CustomSelect/index.js'
import { Byline } from './design-system/Byline.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { Pane } from './design-system/Pane.js'
import { StatusIcon } from './design-system/StatusIcon.js'
import { LoadingState } from './design-system/LoadingState.js'
import TextInput from './TextInput.js'

const PROVIDER_PREFIX = '__AXOLOT_PROVIDER__'
const PROVIDER_MODEL = '__AXOLOT_PROVIDER_MODEL__'
const PROVIDER_BACK = '__AXOLOT_PROVIDER_BACK__'
const PROVIDER_LOGIN_OAUTH = '__AXOLOT_LOGIN_OAUTH__'
const PROVIDER_LOGOUT = '__AXOLOT_LOGOUT__'
const PROVIDER_BASE_URL = '__AXOLOT_PROVIDER_BASE_URL__'
const PROVIDER_ALL_MODELS = '__AXOLOT_ALL_MODELS__'
const PROVIDER_FILTER_MODELS = '__AXOLOT_FILTER_MODELS__'

// A shared endpoint (NVIDIA NIM) returns one 100+ model catalog for every
// provider. Each provider should list only its own family; the full catalog
// lives behind the "your favorite model" option. Keywords are matched
// case-insensitively against the model id (which includes the org prefix).
const PROVIDER_MODEL_KEYWORDS: Record<string, string[]> = {
  deepseek: ['deepseek'],
  glm: ['glm', 'z-ai', 'zai', 'zhipu'],
  kimi: ['kimi', 'moonshot'],
}

const AUTH_URLS: Record<string, { login: string; label: string }> = {
  openai: {
    login: 'https://platform.openai.com/login',
    label: 'platform.openai.com',
  },
  gemini: {
    login: 'https://aistudio.google.com/',
    label: 'aistudio.google.com',
  },
  claude: {
    login: 'https://console.anthropic.com/login',
    label: 'console.anthropic.com',
  },
  deepseek: {
    login: 'https://platform.deepseek.com/api_keys',
    label: 'platform.deepseek.com',
  },
  minimax: {
    login: 'https://platform.minimaxi.com/',
    label: 'platform.minimaxi.com',
  },
  glm: {
    login: 'https://build.nvidia.com/',
    label: 'build.nvidia.com (NVIDIA key)',
  },
  kimi: {
    login: 'https://build.nvidia.com/',
    label: 'build.nvidia.com (NVIDIA key)',
  },
  nvidia: {
    login: 'https://build.nvidia.com/',
    label: 'build.nvidia.com (NVIDIA key)',
  },
}

const providerOptions = [
  {
    id: 'claude',
    label: 'Anthropic',
    description: 'Anthropic API models, e.g. claude-sonnet-5 or claude-opus-5.',
    placeholder: 'claude-sonnet-5',
    hasOAuth: true,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'OpenAI models, e.g. gpt-5.6 or gpt-5.5.',
    placeholder: 'gpt-5.6',
    hasOAuth: true,
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    description: 'Gemini API models, e.g. gemini-3.1-pro or gemini-3.6-flash.',
    placeholder: 'gemini-3.1-pro',
    hasOAuth: false,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek API models, e.g. deepseek-v4-flash.',
    placeholder: 'deepseek-v4-flash',
    hasOAuth: false,
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    description: 'MiniMax API models, e.g. MiniMax-M3.',
    placeholder: 'MiniMax-M3',
    hasOAuth: false,
  },
  {
    id: 'glm',
    label: 'GLM (Zhipu)',
    description: 'GLM via NVIDIA NIM, e.g. z-ai/glm-5.2. Uses your NVIDIA key.',
    placeholder: 'z-ai/glm-5.2',
    hasOAuth: false,
  },
  {
    id: 'kimi',
    label: 'Kimi (Moonshot)',
    description: 'Kimi via NVIDIA NIM, e.g. moonshotai/kimi-k2.6. Uses your NVIDIA key.',
    placeholder: 'moonshotai/kimi-k2.6',
    hasOAuth: false,
  },
  {
    id: 'nvidia',
    label: 'Your favorite model (any NVIDIA model)',
    description: 'Browse the full NVIDIA NIM catalog (100+ models). Uses your NVIDIA key.',
    placeholder: 'z-ai/glm-5.2',
    hasOAuth: false,
  },
] as const

type ProviderOption = (typeof providerOptions)[number]

type Page =
  | { name: 'providers' }
  | { name: 'signin'; provider: ProviderOption }
  | { name: 'oauth-waiting'; provider: ProviderOption }
  | { name: 'openai-oauth-waiting'; provider: ProviderOption }
  | { name: 'enter-key'; provider: ProviderOption }
  | { name: 'enter-model'; provider: ProviderOption }
  | { name: 'enter-base-url'; provider: ProviderOption }
  | { name: 'select-model'; provider: ProviderOption }

type OAuthStatus =
  | { type: 'idle' }
  | { type: 'connecting' }
  | { type: 'waiting' }
  | { type: 'success' }
  | { type: 'error'; message: string }

type Props = {
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}

export function AxolotOpenClawModelPicker({
  onDone,
}: Props): React.ReactNode {
  const setAppState = useSetAppState()
  const terminalSize = useTerminalSize()
  const [page, setPage] = React.useState<Page>({ name: 'providers' })
  const [modelInput, setModelInput] = React.useState('')
  const [keyInput, setKeyInput] = React.useState('')
  const [baseUrlInput, setBaseUrlInput] = React.useState('')
  const [baseUrlError, setBaseUrlError] = React.useState<string | null>(null)
  const [cursorOffset, setCursorOffset] = React.useState(0)
  const [oauthStatus, setOauthStatus] = React.useState<OAuthStatus>({
    type: 'idle',
  })
  const [oauthManualUrl, setOauthManualUrl] = React.useState<string | null>(
    null,
  )
  const [openaiRefreshToken, setOpenaiRefreshToken] = React.useState<
    string | null
  >(null)
  const [remoteModels, setRemoteModels] = React.useState<{
    providerId: string
    baseUrl: string
    ids: string[]
  } | null>(null)
  // When true, the model list shows the endpoint's full catalog instead of just
  // the current provider's family ("your favorite model"). Reset per provider.
  const [browseAll, setBrowseAll] = React.useState(false)

  const activeModel = getOpenClawPrimaryModel()
  const allModels = listOpenClawModels()
  const current = page.name === 'providers' ? null : page.provider

  // Reset the "browse all" toggle whenever the selected provider changes, so
  // each provider opens on its own filtered family, not the full catalog.
  React.useEffect(() => {
    setBrowseAll(false)
  }, [current?.id])

  // OAuth PKCE flow — runs when entering oauth-waiting page
  React.useEffect(() => {
    if (page.name !== 'oauth-waiting' || !current) return

    let cancelled = false

    async function doOAuth() {
      setOauthStatus({ type: 'connecting' })
      try {
        const service = new OAuthService()
        const tokens = await service.startOAuthFlow(
          async manualUrl => {
            if (!cancelled) {
              setOauthManualUrl(manualUrl)
              setOauthStatus({ type: 'waiting' })
            }
          },
          {
            loginWithClaudeAi: true,
            inferenceOnly: true,
          },
        )

        if (cancelled) return

        saveCredentials(current, tokens.accessToken, 'oauth')
        setOauthStatus({ type: 'success' })
      } catch (error) {
        if (!cancelled) {
          setOauthStatus({
            type: 'error',
            message: error instanceof Error ? error.message : 'OAuth failed',
          })
        }
      }
    }

    doOAuth()

    return () => {
      cancelled = true
    }
  }, [page.name, current?.id])

  // OpenAI OAuth PKCE flow — runs when entering openai-oauth-waiting page
  React.useEffect(() => {
    if (page.name !== 'openai-oauth-waiting' || !current) return

    let cancelled = false
    let service: OpenAIOAuthService | null = null

    async function doOAuth() {
      setOauthStatus({ type: 'connecting' })
      try {
        service = new OpenAIOAuthService()
        const result = await service.startFlow(manualUrl => {
          if (!cancelled) {
            setOauthManualUrl(manualUrl)
            setOauthStatus({ type: 'waiting' })
            openBrowser(manualUrl).catch(() => {})
          }
        })

        if (cancelled) return

        saveCredentials(current, result.accessToken, 'oauth')
        if (result.refreshToken) {
          saveRefreshToken(current.id, result.refreshToken)
        }
        setOauthStatus({ type: 'success' })
      } catch (error) {
        if (!cancelled) {
          setOauthStatus({
            type: 'error',
            message: error instanceof Error ? error.message : 'OpenAI OAuth failed',
          })
        }
      }
    }

    doOAuth()

    return () => {
      cancelled = true
      service?.cleanup()
    }
  }, [page.name, current?.id])

  // When the provider points at a custom endpoint, list that endpoint's real
  // model IDs (OpenAI-compatible GET /models) so the user doesn't have to
  // guess names like "deepseek-ai/deepseek-v4-pro" vs "deepseek-v4-pro".
  React.useEffect(() => {
    if (page.name !== 'select-model' || !current) return
    const providerId = current.id
    const baseUrl = getBaseUrl(providerId)
    if (!baseUrl) return
    if (
      remoteModels &&
      remoteModels.providerId === providerId &&
      remoteModels.baseUrl === baseUrl
    ) {
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${baseUrl}/models`, {
          headers: { Authorization: `Bearer ${getApiKey(providerId)}` },
          signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) return
        const data = await res.json()
        const ids = (Array.isArray(data?.data) ? data.data : [])
          .map((m: { id?: unknown }) => String(m?.id || ''))
          .filter(Boolean)
        if (!cancelled && ids.length > 0) {
          // Models matching the provider name first, then the rest.
          ids.sort((a: string, b: string) => {
            const aMatch = a.toLowerCase().includes(providerId) ? 0 : 1
            const bMatch = b.toLowerCase().includes(providerId) ? 0 : 1
            return aMatch - bMatch || a.localeCompare(b)
          })
          setRemoteModels({ providerId, baseUrl, ids })
        }
      } catch {
        // Endpoint without /models (or non-OpenAI-compatible) — keep presets.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [page.name, current?.id])

  // Open browser for non-OAuth providers on signin page
  React.useEffect(() => {
    if (page.name !== 'signin' || !current) return

    const isAuthed = isProviderAuthed(current.id)
    if (!isAuthed && !current.hasOAuth) {
      const authInfo = AUTH_URLS[current.id]
      openBrowser(authInfo.login).catch(() => {})
    }
  }, [page.name, current?.id])

  function providerModelsFor(provider: ProviderOption) {
    return allModels.filter(m => m.id.startsWith(provider.id + '/'))
  }

  function isProviderAuthed(providerId: string): boolean {
    return Boolean(getApiKey(providerId))
  }

  function paneColorFor(provider: ProviderOption | null): string {
    if (!provider) return 'permission'
    if (provider.id === 'claude') return 'claude'
    if (provider.id === 'openai') return 'suggestion'
    if (provider.id === 'gemini') return 'success'
    if (provider.id === 'deepseek') return 'warning'
    if (provider.id === 'minimax') return 'info'
    if (provider.id === 'glm') return 'success'
    if (provider.id === 'kimi') return 'warning'
    if (provider.id === 'nvidia') return 'success'
    return 'permission'
  }

  function saveCredentials(
    provider: ProviderOption,
    rawCredentials: string,
    type: 'apikey' | 'oauth' = 'apikey',
  ): void {
    // Keep only visible ASCII: a trailing newline/zero-width char from the paste
    // would otherwise land in the Authorization header and be rejected at runtime.
    const credentials = String(rawCredentials || '').replace(/[^\x21-\x7E]/g, '')
    if (type === 'oauth') {
      saveOAuthToken(provider.id, credentials)
    } else {
      saveApiKey(provider.id, credentials)
    }
    setActiveProvider(provider.id)

    if (provider.id === 'openai') process.env.OPENAI_API_KEY = credentials
    else if (provider.id === 'gemini') process.env.GEMINI_API_KEY = credentials
    else if (provider.id === 'deepseek') process.env.DEEPSEEK_API_KEY = credentials
    else if (provider.id === 'minimax') process.env.MINIMAX_API_KEY = credentials
    else if (provider.id === 'glm') process.env.GLM_API_KEY = credentials
    else if (provider.id === 'kimi') process.env.KIMI_API_KEY = credentials
    else if (provider.id === 'nvidia') process.env.NVIDIA_API_KEY = credentials
    else if (provider.id === 'claude') {
      if (type === 'oauth') {
        process.env.ANTHROPIC_AUTH_TOKEN = credentials
      } else {
        process.env.ANTHROPIC_API_KEY = credentials
      }
    }

    setPage({ name: 'select-model', provider })
  }

  function setModel(value: string): void {
    const result = setOpenClawModel(value)
    if (!result.ok) {
      onDone(result.message, { display: 'system' })
      return
    }

    setAppState(prev => ({
      ...prev,
      mainLoopModel: value,
      mainLoopModelForSession: null,
    }))

    onDone(`Set AI provider/model to ${chalk.bold(value)}`)
  }

  function modelRef(provider: ProviderOption, rawInput: string): string {
    const input = rawInput.trim()
    if (!input) return ''
    if (input.startsWith(`${provider.id}/`)) return input
    return `${provider.id}/${input}`
  }

  // ===== PAGE: PROVIDER LIST =====
  if (page.name === 'providers') {
    // Select's description only renders plain strings — a React element here
    // gets stringified to "[object Object]".
    const options: OptionWithDescription<string>[] = providerOptions.map(p => {
      const customUrl = getBaseUrl(p.id)
      const status = isProviderAuthed(p.id) ? '✓ Connected' : '○ Not connected'
      return {
        value: `${PROVIDER_PREFIX}${p.id}`,
        label: p.label,
        description: `${status} · ${p.description}${customUrl ? ` · ${customUrl}` : ''}`,
      }
    })

    function handleSelect(value: string): void {
      const providerId = value.slice(PROVIDER_PREFIX.length)
      const provider = providerOptions.find(p => p.id === providerId)
      if (provider) {
        setKeyInput('')
        setPage({ name: 'signin', provider })
      }
    }

    const defaultFocusValue = options[0]?.value

    return (
      <Pane color="permission">
        <Box flexDirection="column">
          <Box marginBottom={1} flexDirection="column">
            <Text color="remember" bold>
              Select your provider and model
            </Text>
            <Text dimColor>
              Choose a provider, sign in, then pick a model.
            </Text>
          </Box>
          <Select
            defaultValue={activeModel}
            defaultFocusValue={defaultFocusValue}
            options={options}
            onChange={handleSelect}
            onCancel={() =>
              onDone('Kept current AI provider/model', { display: 'system' })
            }
            visibleOptionCount={12}
            layout="compact-vertical"
          />
          <Text dimColor italic>
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
            </Byline>
          </Text>
        </Box>
      </Pane>
    )
  }

  // ===== PAGE: OAUTH WAITING (Anthropic only) =====
  if (page.name === 'oauth-waiting' && current) {
    return (
      <Pane color={paneColorFor(current)}>
        <Box flexDirection="column">
          <Box marginBottom={1} flexDirection="column">
            <Text color={paneColorFor(current)} bold>
              {current.label}
            </Text>
            {oauthStatus.type === 'connecting' && (
              <LoadingState message="Opening browser..." />
            )}
            {oauthStatus.type === 'waiting' && (
              <LoadingState message="Waiting for authorization..." subtitle="Check your browser to sign in." />
            )}
            {oauthStatus.type === 'success' && (
              <Box flexDirection="row" gap={1}>
                <StatusIcon status="success" />
                <Text>Connected to {current.label}</Text>
              </Box>
            )}
            {oauthStatus.type === 'error' && (
              <Box flexDirection="column">
                <Box flexDirection="row" gap={1}>
                  <StatusIcon status="error" />
                  <Text color="error">{oauthStatus.message}</Text>
                </Box>
                <Text dimColor>
                  Press Escape to go back and try again, or paste an API key
                  manually.
                </Text>
              </Box>
            )}
          </Box>

          {oauthStatus.type === 'waiting' && (
            <Box marginBottom={1} flexDirection="column" paddingLeft={1}>
              <Text dimColor>If the browser didn't open, visit:</Text>
              <Text color={paneColorFor(current)} wrap="truncate-end">
                {oauthManualUrl || '...'}
              </Text>
            </Box>
          )}

          {oauthStatus.type === 'error' && (
            <Box marginBottom={1}>
              <Select
                options={[
                  {
                    value: PROVIDER_LOGIN_OAUTH,
                    label: 'Retry login',
                    description: 'Try the OAuth login again.',
                  },
                  {
                    value: PROVIDER_BACK,
                    label: 'Paste API key instead',
                    description:
                      'Go back and enter an API key manually.',
                  },
                ]}
                onChange={value => {
                  if (value === PROVIDER_LOGIN_OAUTH) {
                    setOauthStatus({ type: 'idle' })
                    setPage({ name: 'oauth-waiting', provider: current })
                  } else {
                    setPage({ name: 'signin', provider: current })
                  }
                }}
                onCancel={() => setPage({ name: 'signin', provider: current })}
                visibleOptionCount={2}
                layout="compact-vertical"
              />
            </Box>
          )}
        </Box>
      </Pane>
    )
  }

  // ===== PAGE: OPENAI OAUTH WAITING =====
  if (page.name === 'openai-oauth-waiting' && current) {
    return (
      <Pane color={paneColorFor(current)}>
        <Box flexDirection="column">
          <Box marginBottom={1} flexDirection="column">
            <Text color={paneColorFor(current)} bold>
              {current.label}
            </Text>
            {oauthStatus.type === 'connecting' && (
              <LoadingState message="Starting login..." />
            )}
            {oauthStatus.type === 'waiting' && (
              <LoadingState message="Waiting for authorization..." subtitle="Check your browser to sign in." />
            )}
            {oauthStatus.type === 'success' && (
              <Box flexDirection="row" gap={1}>
                <StatusIcon status="success" />
                <Text>Connected to {current.label}</Text>
              </Box>
            )}
            {oauthStatus.type === 'error' && (
              <Box flexDirection="column">
                <Box flexDirection="row" gap={1}>
                  <StatusIcon status="error" />
                  <Text color="error">{oauthStatus.message}</Text>
                </Box>
                <Text dimColor>
                  Press Escape to go back and try again, or paste an API key
                  manually.
                </Text>
              </Box>
            )}
          </Box>

          {oauthStatus.type === 'waiting' && (
            <Box marginBottom={1} flexDirection="column" paddingLeft={1}>
              <Text dimColor>If the browser didn't open, visit:</Text>
              <Text color={paneColorFor(current)} wrap="truncate-end">
                {oauthManualUrl || '...'}
              </Text>
            </Box>
          )}

          {oauthStatus.type === 'error' && (
            <Box marginBottom={1}>
              <Select
                options={[
                  {
                    value: PROVIDER_LOGIN_OAUTH,
                    label: 'Retry login',
                    description: 'Try the OAuth login again.',
                  },
                  {
                    value: PROVIDER_BACK,
                    label: 'Paste API key instead',
                    description: 'Go back and enter an API key manually.',
                  },
                ]}
                onChange={value => {
                  if (value === PROVIDER_LOGIN_OAUTH) {
                    setOauthStatus({ type: 'idle' })
                    setPage({
                      name: 'openai-oauth-waiting',
                      provider: current,
                    })
                  } else {
                    setPage({ name: 'signin', provider: current })
                  }
                }}
                onCancel={() => setPage({ name: 'signin', provider: current })}
                visibleOptionCount={2}
                layout="compact-vertical"
              />
            </Box>
          )}
        </Box>
      </Pane>
    )
  }

  // ===== PAGE: SIGN IN (for OpenAI/Gemini or manual key entry) =====
  if (page.name === 'signin' && current) {
    const authInfo = AUTH_URLS[current.id]
    const isAuthed = isProviderAuthed(current.id)

    const actions: OptionWithDescription<string>[] = []

    if (current.hasOAuth) {
      actions.push({
        value: PROVIDER_LOGIN_OAUTH,
        label: 'Login with browser',
        description:
          'Opens your browser to sign in to your Anthropic account.',
      })
    }

    // Already connected: lead with "Pick model" so a stored key never forces a
    // re-entry. The key persists across sessions (Conf store), and NVIDIA-hosted
    // providers share one key — so switching glm↔deepseek↔kimi never re-prompts.
    if (isAuthed) {
      actions.push({
        value: PROVIDER_MODEL,
        label: 'Pick model',
        description: 'Already connected. Jump to model selection.',
      })
    }

    actions.push({
      value: PROVIDER_BACK,
      label: isAuthed ? 'Replace API key' : 'Paste API key',
      description: isAuthed
        ? `Replace the stored API key for ${current.label}.`
        : `Enter an API key for ${current.label} manually.`,
    })

    if (isAuthed) {
      actions.push({
        value: PROVIDER_LOGOUT,
        label: 'Disconnect',
        description: `Remove stored credentials for ${current.label}.`,
      })
    }

    return (
      <Pane color={paneColorFor(current)}>
        <Box flexDirection="column">
          <Box marginBottom={1} flexDirection="column">
            <Text color={paneColorFor(current)} bold>
              {current.label}
            </Text>
            <Box flexDirection="row" gap={1}>
              <StatusIcon
                status={isAuthed ? 'success' : 'pending'}
                withSpace={false}
              />
              <Text dimColor>
                {isAuthed
                  ? 'Connected — pick a model, or replace the stored key.'
                  : current.hasOAuth
                    ? 'Sign in with your browser, or paste an API key.'
                    : 'Paste your API key below to connect.'}
              </Text>
            </Box>
          </Box>

          {!current.hasOAuth && !isAuthed && (
            <Box marginBottom={1} flexDirection="column" paddingLeft={1}>
              <Text dimColor>
                After logging in, create an API key and paste it below:
              </Text>
              <Text color={paneColorFor(current)} wrap="truncate-end">
                {authInfo.login.replace('/login', '/api-keys')}
              </Text>
            </Box>
          )}

          {current.hasOAuth || isAuthed ? (
            <Select
              options={actions}
              onChange={value => {
                if (value === PROVIDER_LOGIN_OAUTH) {
                  if (current.id === 'openai') {
                    setPage({ name: 'openai-oauth-waiting', provider: current })
                  } else {
                    setPage({ name: 'oauth-waiting', provider: current })
                  }
                } else if (value === PROVIDER_LOGOUT) {
                  clearCredentials(current.id)
                  setPage({ name: 'providers' })
                } else if (value === PROVIDER_MODEL) {
                  setPage({ name: 'select-model', provider: current })
                } else {
                  setKeyInput('')
                  setPage({ name: 'enter-key', provider: current })
                }
              }}
              onCancel={() => setPage({ name: 'providers' })}
              visibleOptionCount={actions.length}
              layout="compact-vertical"
            />
          ) : (
            <Box flexDirection="column">
              <Box marginBottom={1} flexDirection="column">
                <Text bold>API key:</Text>
              </Box>
              <TextInput
                value={keyInput}
                onChange={setKeyInput}
                onSubmit={() => {
                  if (keyInput.trim()) {
                    saveCredentials(current, keyInput)
                  }
                }}
                onExit={() => {
                  if (isAuthed) {
                    setPage({ name: 'select-model', provider: current })
                  } else {
                    setPage({ name: 'providers' })
                  }
                }}
                focus={true}
                placeholder="sk-..."
                columns={terminalSize.columns}
                cursorOffset={cursorOffset}
                onChangeCursorOffset={setCursorOffset}
                showCursor={true}
              />
              <Box marginTop={1} flexDirection="column">
                <Text dimColor italic>
                  <Byline>
                    <KeyboardShortcutHint
                      shortcut="Enter"
                      action="save & continue"
                    />
                    <KeyboardShortcutHint shortcut="Escape" action="back" />
                  </Byline>
                </Text>
              </Box>
            </Box>
          )}
        </Box>
      </Pane>
    )
  }

  // ===== PAGE: ENTER API KEY (for OpenAI/Gemini, or manual fallback) =====
  if (page.name === 'enter-key' && current) {
    return (
      <Pane color={paneColorFor(current)}>
        <Box flexDirection="column">
          <Box marginBottom={1} flexDirection="column">
            <Text color={paneColorFor(current)} bold>
              {current.label} API Key
            </Text>
            <Text dimColor>
              Paste your {current.label} API key below.
            </Text>
          </Box>
          <TextInput
            value={keyInput}
            onChange={setKeyInput}
            onSubmit={() => {
              if (keyInput.trim()) {
                saveCredentials(current, keyInput)
              }
            }}
            onExit={() => setPage({ name: 'signin', provider: current })}
            focus={true}
            placeholder="sk-..."
            columns={terminalSize.columns}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
            showCursor={true}
          />
          <Box marginTop={1} flexDirection="column">
            <Text dimColor italic>
              <Byline>
                <KeyboardShortcutHint
                  shortcut="Enter"
                  action="save & continue"
                />
                <KeyboardShortcutHint shortcut="Escape" action="back" />
              </Byline>
            </Text>
          </Box>
        </Box>
      </Pane>
    )
  }

  // ===== PAGE: ENTER MODEL NAME =====
  if (page.name === 'enter-model' && current) {
    const ref = modelRef(current, modelInput)
    return (
      <Pane color={paneColorFor(current)}>
        <Box flexDirection="column">
          <Box marginBottom={1} flexDirection="column">
            <Text color={paneColorFor(current)} bold>
              {current.label}
            </Text>
            <Text dimColor>
              Type the model name to use.
            </Text>
          </Box>
          <TextInput
            value={modelInput}
            onChange={setModelInput}
            onSubmit={() => {
              if (ref) setModel(ref)
            }}
            onExit={() =>
              setPage({ name: 'select-model', provider: current })
            }
            focus={true}
            placeholder={current.placeholder}
            columns={terminalSize.columns}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
            showCursor={true}
          />
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>
              Model ref: {ref || `${current.id}/...`}
            </Text>
            <Text dimColor italic>
              <Byline>
                <KeyboardShortcutHint shortcut="Enter" action="confirm" />
                <KeyboardShortcutHint shortcut="Escape" action="back" />
              </Byline>
            </Text>
          </Box>
        </Box>
      </Pane>
    )
  }

  // ===== PAGE: ENTER BASE URL =====
  if (page.name === 'enter-base-url' && current) {
    const currentUrl = getBaseUrl(current.id)
    return (
      <Pane color={paneColorFor(current)}>
        <Box flexDirection="column">
          <Box marginBottom={1} flexDirection="column">
            <Text color={paneColorFor(current)} bold>
              {current.label} Base URL
            </Text>
            <Text dimColor>
              Point {current.label} requests at any compatible endpoint (NVIDIA
              NIM, OpenRouter, a local gateway...). Your API key must belong to
              that endpoint.
            </Text>
            {currentUrl ? (
              <Text dimColor>Current: {currentUrl}</Text>
            ) : (
              <Text dimColor>Currently using the official {current.label} API.</Text>
            )}
          </Box>
          <TextInput
            value={baseUrlInput}
            onChange={value => {
              setBaseUrlInput(value)
              if (baseUrlError) setBaseUrlError(null)
            }}
            onSubmit={() => {
              const trimmed = baseUrlInput.trim()
              try {
                if (trimmed) {
                  saveBaseUrl(current.id, trimmed)
                } else {
                  clearBaseUrl(current.id)
                }
              } catch (error) {
                setBaseUrlError(
                  error instanceof Error ? error.message : 'Invalid base URL',
                )
                return
              }
              // The Anthropic SDK reads its endpoint from the environment, so
              // keep it in sync for the current session.
              if (current.id === 'claude') {
                if (trimmed) {
                  process.env.ANTHROPIC_BASE_URL = trimmed.replace(/\/+$/, '')
                } else {
                  delete process.env.ANTHROPIC_BASE_URL
                }
              }
              setPage({ name: 'select-model', provider: current })
            }}
            onExit={() => setPage({ name: 'select-model', provider: current })}
            focus={true}
            placeholder="https://integrate.api.nvidia.com/v1"
            columns={terminalSize.columns}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
            showCursor={true}
          />
          {baseUrlError && (
            <Box marginTop={1}>
              <Text color="error">{baseUrlError}</Text>
            </Box>
          )}
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>
              Leave empty and press Enter to go back to the default endpoint.
            </Text>
            <Text dimColor italic>
              <Byline>
                <KeyboardShortcutHint shortcut="Enter" action="save" />
                <KeyboardShortcutHint shortcut="Escape" action="back" />
              </Byline>
            </Text>
          </Box>
        </Box>
      </Pane>
    )
  }

  // ===== PAGE: SELECT MODEL =====
  if (page.name === 'select-model' && current) {
    const customBaseUrl = getBaseUrl(current.id)
    const fullCatalog =
      customBaseUrl &&
      remoteModels &&
      remoteModels.providerId === current.id &&
      remoteModels.baseUrl === customBaseUrl
        ? remoteModels.ids
        : null
    const models = providerModelsFor(current)
    const endpointHost = customBaseUrl
      ? customBaseUrl.replace(/^https?:\/\//, '').split('/')[0]
      : ''

    // A shared endpoint (NVIDIA NIM) hands back one 100+ model catalog for every
    // provider. Filter it to just this provider's family, then sort newest-first
    // (numeric-aware) so the latest version — e.g. glm-5.2 over glm-4.6 — is the
    // top pick. "Browse all" reveals the untouched catalog.
    // The "nvidia" provider ("your favorite model") is the deliberate all-models
    // view, so it never filters. Others filter to their own family.
    const keywords =
      current.id === 'nvidia'
        ? null
        : PROVIDER_MODEL_KEYWORDS[current.id] || [current.id]
    const familyModels =
      fullCatalog && keywords
        ? fullCatalog.filter(id => {
            const lower = id.toLowerCase()
            return keywords.some(k => lower.includes(k))
          })
        : null
    const hasExtraModels = Boolean(
      fullCatalog &&
        familyModels &&
        familyModels.length > 0 &&
        fullCatalog.length > familyModels.length,
    )
    // Default to the filtered family; if the filter matched nothing (unfamiliar
    // naming), fall back to the full catalog so the user is never stranded.
    const endpointModels = fullCatalog
      ? browseAll || !familyModels || familyModels.length === 0
        ? fullCatalog
        : [...familyModels].sort((a, b) =>
            b.localeCompare(a, undefined, { numeric: true }),
          )
      : null
    const options: OptionWithDescription<string>[] = [
      // Custom endpoint: its real catalog replaces the built-in presets,
      // which most likely don't exist there.
      ...(endpointModels
        ? endpointModels.map(id => {
            const ref = `${current.id}/${id}`
            return {
              value: ref,
              label:
                ref === activeModel ? (
                  <Text>
                    {id} <Text color="success">(active)</Text>
                  </Text>
                ) : (
                  id
                ),
              description: `From ${endpointHost}`,
            } as OptionWithDescription<string>
          })
        : models.map(m => ({
            value: m.id,
            label:
              m.id === activeModel ? (
                <Text>
                  {m.id} <Text color="success">(active)</Text>
                </Text>
              ) : (
                m.id
              ),
            description: [m.input, m.context ? `${m.context} ctx` : '']
              .filter(Boolean)
              .join(' · '),
          }))),
      ...(!endpointModels && models.length === 0
        ? [
            {
              value: `${current.id}/${current.placeholder}`,
              label: `${current.id}/${current.placeholder}`,
              description: `Default ${current.label} model preset.`,
            } as OptionWithDescription<string>,
          ]
        : []),
      // "Your favorite model": reveal the endpoint's full catalog (or fold back
      // to just this provider's family). Only shown when the endpoint actually
      // hosts more models than this provider's family.
      ...(hasExtraModels
        ? [
            browseAll
              ? ({
                  value: PROVIDER_FILTER_MODELS,
                  label: `Show only ${current.label} models`,
                  description: `Back to the ${current.label} family.`,
                } as OptionWithDescription<string>)
              : ({
                  value: PROVIDER_ALL_MODELS,
                  label: '⭐ Your favorite model (browse all)',
                  description: `See every model on ${endpointHost} (${fullCatalog?.length ?? 0}).`,
                } as OptionWithDescription<string>),
          ]
        : []),
      {
        value: PROVIDER_MODEL,
        label: 'Enter model name manually',
        description: `Type a custom model name for ${current.label}.`,
      },
      {
        value: PROVIDER_BASE_URL,
        label: 'Set custom base URL',
        description: getBaseUrl(current.id)
          ? `Current: ${getBaseUrl(current.id)} — change or clear the endpoint.`
          : 'Use a compatible endpoint (NVIDIA NIM, OpenRouter, gateway...).',
      },
      {
        value: PROVIDER_BACK,
        label: 'Change provider',
        description: 'Go back to pick a different provider.',
      },
    ]

    return (
      <Pane color={paneColorFor(current)}>
        <Box flexDirection="column">
          <Box marginBottom={1} flexDirection="column">
            <Text color={paneColorFor(current)} bold>
              {current.label} Models
            </Text>
            <Text dimColor>
              Pick a model to start working with {current.label}.
            </Text>
            {customBaseUrl && !endpointModels && (
              <Text dimColor>Loading models from {endpointHost}...</Text>
            )}
            {endpointModels && (
              <Text dimColor>
                {browseAll || current.id === 'nvidia' || !familyModels
                  ? `Showing all ${endpointModels.length} models from ${endpointHost}.`
                  : `Showing ${endpointModels.length} ${current.label} model${
                      endpointModels.length === 1 ? '' : 's'
                    } from ${endpointHost}.`}
              </Text>
            )}
          </Box>
          <Select
            options={options}
            onChange={value => {
              if (value === PROVIDER_MODEL) {
                setModelInput('')
                setCursorOffset(0)
                setPage({ name: 'enter-model', provider: current })
              } else if (value === PROVIDER_BASE_URL) {
                const existing = getBaseUrl(current.id)
                setBaseUrlInput(existing)
                setBaseUrlError(null)
                setCursorOffset(existing.length)
                setPage({ name: 'enter-base-url', provider: current })
              } else if (value === PROVIDER_BACK) {
                setPage({ name: 'providers' })
              } else if (value === PROVIDER_ALL_MODELS) {
                setBrowseAll(true)
              } else if (value === PROVIDER_FILTER_MODELS) {
                setBrowseAll(false)
              } else {
                setModel(value)
              }
            }}
            onCancel={() =>
              onDone('Kept current AI provider/model', { display: 'system' })
            }
            visibleOptionCount={12}
            layout="compact-vertical"
          />
          <Text dimColor italic>
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
            </Byline>
          </Text>
        </Box>
      </Pane>
    )
  }

  return null
}
