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
} from '../utils/claudex/openclaw.js'
import {
  saveApiKey,
  saveOAuthToken,
  saveRefreshToken,
  getApiKey,
  clearCredentials,
  setActiveProvider,
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

const PROVIDER_PREFIX = '__CLAUDEX_PROVIDER__'
const PROVIDER_MODEL = '__CLAUDEX_PROVIDER_MODEL__'
const PROVIDER_BACK = '__CLAUDEX_PROVIDER_BACK__'
const PROVIDER_LOGIN_OAUTH = '__CLAUDEX_LOGIN_OAUTH__'
const PROVIDER_LOGOUT = '__CLAUDEX_LOGOUT__'

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
}

const providerOptions = [
  {
    id: 'claude',
    label: 'Anthropic',
    description: 'Claude API models, e.g. claude-sonnet-4-5.',
    placeholder: 'claude-sonnet-4-5',
    hasOAuth: true,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'OpenAI models, e.g. gpt-4o.',
    placeholder: 'gpt-4o',
    hasOAuth: true,
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    description: 'Gemini API models, e.g. gemini-2.5-pro.',
    placeholder: 'gemini-2.5-pro',
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

export function ClaudexOpenClawModelPicker({
  onDone,
}: Props): React.ReactNode {
  const setAppState = useSetAppState()
  const terminalSize = useTerminalSize()
  const [page, setPage] = React.useState<Page>({ name: 'providers' })
  const [modelInput, setModelInput] = React.useState('')
  const [keyInput, setKeyInput] = React.useState('')
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

  const activeModel = getOpenClawPrimaryModel()
  const allModels = listOpenClawModels()
  const current = page.name === 'providers' ? null : page.provider

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
    return 'permission'
  }

  function saveCredentials(
    provider: ProviderOption,
    credentials: string,
    type: 'apikey' | 'oauth' = 'apikey',
  ): void {
    if (type === 'oauth') {
      saveOAuthToken(provider.id, credentials)
    } else {
      saveApiKey(provider.id, credentials)
    }
    setActiveProvider(provider.id)

    if (provider.id === 'openai') process.env.OPENAI_API_KEY = credentials
    else if (provider.id === 'gemini') process.env.GEMINI_API_KEY = credentials
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
    const options: OptionWithDescription<string>[] = providerOptions.map(p => ({
      value: `${PROVIDER_PREFIX}${p.id}`,
      label: p.label,
      description: (
        <Box flexDirection="row" gap={1}>
          <StatusIcon
            status={isProviderAuthed(p.id) ? 'success' : 'pending'}
            withSpace={false}
          />
          <Text>{p.description}</Text>
        </Box>
      ),
    }))

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

    actions.push({
      value: PROVIDER_BACK,
      label: 'Paste API key',
      description: `Enter an API key for ${current.label} manually.`,
    })

    if (isAuthed) {
      actions.push({
        value: PROVIDER_MODEL,
        label: 'Pick model',
        description: 'Already connected. Jump to model selection.',
      })
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
                  ? 'Connected'
                  : current.hasOAuth
                    ? 'Sign in with your browser, or paste an API key.'
                    : `Opening ${authInfo.label} in your browser...`}
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

          {current.hasOAuth ? (
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

  // ===== PAGE: SELECT MODEL =====
  if (page.name === 'select-model' && current) {
    const models = providerModelsFor(current)
    const options: OptionWithDescription<string>[] = [
      ...models.map(m => ({
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
      })),
      ...(models.length === 0
        ? [
            {
              value: `${current.id}/${current.placeholder}`,
              label: `${current.id}/${current.placeholder}`,
              description: `Default ${current.label} model preset.`,
            } as OptionWithDescription<string>,
          ]
        : []),
      {
        value: PROVIDER_MODEL,
        label: 'Enter model name manually',
        description: `Type a custom model name for ${current.label}.`,
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
          </Box>
          <Select
            options={options}
            onChange={value => {
              if (value === PROVIDER_MODEL) {
                setModelInput('')
                setCursorOffset(0)
                setPage({ name: 'enter-model', provider: current })
              } else if (value === PROVIDER_BACK) {
                setPage({ name: 'providers' })
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
