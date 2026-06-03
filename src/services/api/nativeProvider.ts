import { randomUUID } from 'crypto'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
} from '../../types/message.js'
import { createAssistantAPIErrorMessage } from '../../utils/messages.js'
import type { SystemPrompt } from '../../utils/systemPromptType.js'
import Conf from 'conf'

const directStore = new Conf({
  projectName: 'claudex',
  configName: 'direct-providers',
})

type NativeProvider = 'openai' | 'gemini'

type NativeRoute = {
  provider: NativeProvider
  model: string
}

export function getNativeProviderRoute(model: string): NativeRoute | null {
  const raw = String(model || '').trim()
  const lower = raw.toLowerCase()

  if (lower.startsWith('openai/')) {
    return { provider: 'openai', model: raw.slice('openai/'.length) }
  }

  if (lower.startsWith('gemini/') || lower.startsWith('google/')) {
    return { provider: 'gemini', model: raw.slice(raw.indexOf('/') + 1) }
  }

  const envProvider = process.env.CLAUDEX_NATIVE_PROVIDER?.toLowerCase()
  if (envProvider === 'openai' || envProvider === 'gemini') {
    return { provider: envProvider, model: raw }
  }

  return null
}

export async function* queryNativeProvider({
  messages,
  systemPrompt,
  signal,
  model,
}: {
  messages: Message[]
  systemPrompt: SystemPrompt
  signal: AbortSignal
  model: string
}): AsyncGenerator<StreamEvent | AssistantMessage | SystemAPIErrorMessage> {
  const route = getNativeProviderRoute(model)
  if (!route) return

  try {
    yield fakeStreamEvent({
      type: 'message_start',
      message: {
        id: randomUUID(),
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: emptyUsage(),
      },
    }, 0)
    yield fakeStreamEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    })

    let text = ''
    const onChunk = (chunk: string) => {
      text += chunk
      return fakeStreamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: chunk },
      })
    }

    if (route.provider === 'openai') {
      for await (const event of streamOpenAI(route.model, messages, systemPrompt, signal, onChunk)) {
        yield event
      }
    } else {
      for await (const event of streamGemini(route.model, messages, systemPrompt, signal, onChunk)) {
        yield event
      }
    }

    yield fakeStreamEvent({
      type: 'content_block_stop',
      index: 0,
    })
    yield fakeStreamEvent({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: {
        output_tokens: Math.max(1, Math.ceil(text.length / 4)),
      },
    })
    yield fakeStreamEvent({ type: 'message_stop' })

    yield createNativeAssistantMessage(model, text)
  } catch (error) {
    if (signal.aborted) return
    yield createAssistantAPIErrorMessage({
      content: `Provider error (${route.provider}): ${formatError(error)}`,
      apiError: 'api_error',
      error: 'api_error',
    })
  }
}

function storeApiKey(provider: string): string {
  return (
    process.env[provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'] ||
    (directStore.get(`apiKeys.${provider}`) as string) ||
    ''
  )
}

async function ensureOpenAIToken(): Promise<string> {
  const isOAuth =
    (directStore.get('credentialType.openai') as string) === 'oauth'
  if (!isOAuth) return storeApiKey('openai')

  const token = storeApiKey('openai')
  if (!token) throw new Error('No OpenAI token stored')

  const { isJWTExpired, OpenAIOAuthService } = await import(
    '../oauth/openai.js'
  )

  if (!isJWTExpired(token)) return token

  const refreshToken = (directStore.get('refreshTokens.openai') as string) || ''
  if (!refreshToken)
    throw new Error(
      'OpenAI OAuth token expiró y no hay refresh token. Vuelve a iniciar sesión con /model.',
    )

  const refreshed = await OpenAIOAuthService.refreshAccessToken(refreshToken)
  directStore.set('apiKeys.openai', refreshed.accessToken)
  if (refreshed.refreshToken) {
    directStore.set('refreshTokens.openai', refreshed.refreshToken)
  }
  return refreshed.accessToken
}

async function* streamOpenAI(
  model: string,
  messages: Message[],
  systemPrompt: SystemPrompt,
  signal: AbortSignal,
  onChunk: (chunk: string) => StreamEvent,
): AsyncGenerator<StreamEvent> {
  const apiKey = await ensureOpenAIToken()
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured')

  const isOAuthKey =
    (directStore.get('credentialType.openai') as string) === 'oauth'

  if (isOAuthKey) {
    yield* streamOpenAIResponses(model, messages, systemPrompt, signal, onChunk, apiKey)
  } else {
    yield* streamOpenAIChat(model, messages, systemPrompt, signal, onChunk, apiKey)
  }
}

async function* streamOpenAIChat(
  model: string,
  messages: Message[],
  systemPrompt: SystemPrompt,
  signal: AbortSignal,
  onChunk: (chunk: string) => StreamEvent,
  apiKey: string,
): AsyncGenerator<StreamEvent> {
  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey })
  const stream = await client.chat.completions.create(
    {
      model,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt.join('\n\n') },
        ...messagesToOpenAI(messages),
      ],
    },
    { signal },
  )

  for await (const part of stream) {
    const delta = part.choices?.[0]?.delta?.content
    if (delta) yield onChunk(delta)
  }
}

async function* streamOpenAIResponses(
  model: string,
  messages: Message[],
  systemPrompt: SystemPrompt,
  signal: AbortSignal,
  onChunk: (chunk: string) => StreamEvent,
  apiKey: string,
): AsyncGenerator<StreamEvent> {
  const isOAuthKey =
    (directStore.get('credentialType.openai') as string) === 'oauth'

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'OpenAI-Beta': 'responses=v1',
  }

  if (isOAuthKey) {
    const parts = apiKey.split('.')
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(
          Buffer.from(parts[1], 'base64').toString('utf-8'),
        )
        const accountId =
          payload['https://api.openai.com/auth/claims/account_id'] ||
          payload.sub?.split('|')?.[1]
        if (accountId) headers['chatgpt-account-id'] = accountId
      } catch {}
    }
  }

  const input = messagesToOpenAI(messages)

  const body = JSON.stringify({
    model,
    input,
    instructions: systemPrompt.join('\n\n'),
    stream: true,
    store: false,
  })

  const url = isOAuthKey
    ? 'https://chatgpt.com/backend-api/codex/responses'
    : 'https://api.openai.com/v1/responses'

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Responses API error (${response.status}): ${text}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6)
      if (data === '[DONE]') return

      try {
        const event = JSON.parse(data)
        if (event.type === 'response.output_text.delta' && event.delta) {
          yield onChunk(event.delta)
        }
      } catch {
        // skip malformed JSON
      }
    }
  }
}

async function* streamGemini(
  model: string,
  messages: Message[],
  systemPrompt: SystemPrompt,
  signal: AbortSignal,
  onChunk: (chunk: string) => StreamEvent,
): AsyncGenerator<StreamEvent> {
  const apiKey = storeApiKey('gemini')
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')

  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const client = new GoogleGenerativeAI(apiKey)
  const genModel = client.getGenerativeModel({
    model,
    systemInstruction: systemPrompt.join('\n\n'),
  })
  const result = await genModel.generateContentStream(
    {
      contents: messagesToGemini(messages),
    },
    { signal },
  )

  for await (const part of result.stream) {
    const delta = part.text()
    if (delta) yield onChunk(delta)
  }
}

function messagesToOpenAI(messages: Message[]): Array<{
  role: 'user' | 'assistant'
  content: string
}> {
  return messages.flatMap(message => {
    const role = (message as any).message?.role
    if (role !== 'user' && role !== 'assistant') return []
    const content = contentToText((message as any).message?.content)
    if (!content) return []
    return [{ role, content }]
  })
}

function messagesToGemini(messages: Message[]): Array<{
  role: 'user' | 'model'
  parts: Array<{ text: string }>
}> {
  return messages.flatMap(message => {
    const role = (message as any).message?.role
    if (role !== 'user' && role !== 'assistant') return []
    const text = contentToText((message as any).message?.content)
    if (!text) return []
    return [
      {
        role: role === 'assistant' ? 'model' : 'user',
        parts: [{ text }],
      },
    ]
  })
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map(block => {
      if (block && typeof block === 'object' && (block as any).type === 'text') {
        return String((block as any).text || '')
      }
      if (
        block &&
        typeof block === 'object' &&
        (block as any).type === 'tool_result'
      ) {
        return `[tool_result]\n${contentToText((block as any).content)}`
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function createNativeAssistantMessage(
  model: string,
  text: string,
): AssistantMessage {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    requestId: undefined,
    message: {
      id: randomUUID(),
      container: null,
      model,
      role: 'assistant',
      stop_reason: 'end_turn',
      stop_sequence: null,
      type: 'message',
      usage: {
        ...emptyUsage(),
        output_tokens: Math.max(1, Math.ceil(text.length / 4)),
      },
      content: [{ type: 'text', text: text || '(no content)' }],
      context_management: null,
    },
  } as AssistantMessage
}

function fakeStreamEvent(event: Record<string, unknown>, ttftMs?: number): StreamEvent {
  return {
    type: 'stream_event',
    event,
    ...(ttftMs !== undefined ? { ttftMs } : {}),
  } as StreamEvent
}

function emptyUsage() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
    service_tier: null,
    cache_creation: {
      ephemeral_1h_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
    },
    inference_geo: null,
    iterations: null,
    speed: null,
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
