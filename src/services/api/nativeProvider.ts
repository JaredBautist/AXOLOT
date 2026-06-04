import { randomUUID } from 'crypto'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
} from '../../types/message.js'
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js'
import type { ToolPermissionContext, Tools } from '../../Tool.js'
import { toolToAPISchema } from '../../utils/api.js'
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

type NativeToolOptions = {
  getToolPermissionContext: () => Promise<ToolPermissionContext>
  agents: AgentDefinition[]
  allowedAgentTypes?: string[]
  isNonInteractiveSession: boolean
}

type NativeToolCall = {
  id: string
  name: string
  input: Record<string, unknown>
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
  tools,
  options,
}: {
  messages: Message[]
  systemPrompt: SystemPrompt
  signal: AbortSignal
  model: string
  tools: Tools
  options: NativeToolOptions
}): AsyncGenerator<StreamEvent | AssistantMessage | SystemAPIErrorMessage> {
  const route = getNativeProviderRoute(model)
  if (!route) return

  try {
    const nativeTools = await buildNativeToolSchemas(tools, options, model)
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
    let toolCalls: NativeToolCall[] = []
    const onChunk = (chunk: string) => {
      text += chunk
      return fakeStreamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: chunk },
      })
    }

    if (route.provider === 'openai') {
      for await (const event of streamOpenAI(route.model, messages, systemPrompt, signal, nativeTools.openai, onChunk)) {
        if (event.type === 'tool_calls') toolCalls = event.toolCalls
        else yield event.event
      }
    } else {
      for await (const event of streamGemini(route.model, messages, systemPrompt, signal, nativeTools.gemini, onChunk)) {
        if (event.type === 'tool_calls') toolCalls = event.toolCalls
        else yield event.event
      }
    }

    yield fakeStreamEvent({
      type: 'content_block_stop',
      index: 0,
    })
    yield fakeStreamEvent({
      type: 'message_delta',
      delta: { stop_reason: toolCalls.length > 0 ? 'tool_use' : 'end_turn', stop_sequence: null },
      usage: {
        output_tokens: Math.max(1, Math.ceil(text.length / 4)),
      },
    })
    yield fakeStreamEvent({ type: 'message_stop' })

    yield createNativeAssistantMessage(model, text, toolCalls)
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
  tools: OpenAIToolSchema[],
  onChunk: (chunk: string) => StreamEvent,
): AsyncGenerator<{ type: 'event'; event: StreamEvent } | { type: 'tool_calls'; toolCalls: NativeToolCall[] }> {
  const apiKey = await ensureOpenAIToken()
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured')

  const isOAuthKey =
    (directStore.get('credentialType.openai') as string) === 'oauth'

  if (isOAuthKey) {
    yield* streamOpenAIResponses(model, messages, systemPrompt, signal, tools, onChunk, apiKey)
  } else {
    yield* streamOpenAIChat(model, messages, systemPrompt, signal, tools, onChunk, apiKey)
  }
}

async function* streamOpenAIChat(
  model: string,
  messages: Message[],
  systemPrompt: SystemPrompt,
  signal: AbortSignal,
  tools: OpenAIToolSchema[],
  onChunk: (chunk: string) => StreamEvent,
  apiKey: string,
): AsyncGenerator<{ type: 'event'; event: StreamEvent } | { type: 'tool_calls'; toolCalls: NativeToolCall[] }> {
  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey })
  const toolCallChunks = new Map<number, { id: string; name: string; arguments: string }>()
  const stream = await client.chat.completions.create(
    {
      model,
      stream: true,
      messages: [
        { role: 'system', content: nativeSystemPrompt(systemPrompt) },
        ...messagesToOpenAI(messages),
      ],
      ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
    },
    { signal },
  )

  for await (const part of stream) {
    const delta = part.choices?.[0]?.delta?.content
    if (delta) yield { type: 'event', event: onChunk(delta) }

    for (const call of part.choices?.[0]?.delta?.tool_calls ?? []) {
      const index = call.index ?? 0
      const existing = toolCallChunks.get(index) ?? {
        id: '',
        name: '',
        arguments: '',
      }
      if (call.id) existing.id = call.id
      if (call.function?.name) existing.name = call.function.name
      if (call.function?.arguments) existing.arguments += call.function.arguments
      toolCallChunks.set(index, existing)
    }
  }

  const toolCalls = [...toolCallChunks.values()]
    .filter(call => call.name)
    .map(call => ({
      id: call.id || randomUUID(),
      name: call.name,
      input: parseToolArguments(call.arguments),
    }))
  if (toolCalls.length > 0) yield { type: 'tool_calls', toolCalls }
}

async function* streamOpenAIResponses(
  model: string,
  messages: Message[],
  systemPrompt: SystemPrompt,
  signal: AbortSignal,
  tools: OpenAIToolSchema[],
  onChunk: (chunk: string) => StreamEvent,
  apiKey: string,
): AsyncGenerator<{ type: 'event'; event: StreamEvent } | { type: 'tool_calls'; toolCalls: NativeToolCall[] }> {
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
    instructions: nativeSystemPrompt(systemPrompt),
    stream: true,
    store: false,
    ...(tools.length > 0 ? { tools: tools.map(toResponsesTool), tool_choice: 'auto' } : {}),
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
  const toolCallChunks = new Map<string, { id: string; name: string; arguments: string }>()

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
          yield { type: 'event', event: onChunk(event.delta) }
        }
        if (event.type === 'response.function_call_arguments.delta') {
          const id = String(event.item_id || event.output_index || randomUUID())
          const existing = toolCallChunks.get(id) ?? {
            id,
            name: String(event.name || ''),
            arguments: '',
          }
          existing.arguments += String(event.delta || '')
          toolCallChunks.set(id, existing)
        } else if (
          (event.type === 'response.output_item.added' ||
            event.type === 'response.output_item.done') &&
          event.item?.type === 'function_call'
        ) {
          const id = String(event.item.id || event.output_index || randomUUID())
          const existing = toolCallChunks.get(id) ?? {
            id,
            name: '',
            arguments: '',
          }
          if (event.item.name) existing.name = String(event.item.name)
          if (event.type === 'response.output_item.done') {
            existing.arguments = String(event.item.arguments || existing.arguments)
          }
          toolCallChunks.set(id, existing)
        }
      } catch {
        // skip malformed JSON
      }
    }
  }

  const toolCalls = [...toolCallChunks.values()]
    .filter(call => call.name)
    .map(call => ({
      id: call.id || randomUUID(),
      name: call.name,
      input: parseToolArguments(call.arguments),
    }))
  if (toolCalls.length > 0) yield { type: 'tool_calls', toolCalls }
}

async function* streamGemini(
  model: string,
  messages: Message[],
  systemPrompt: SystemPrompt,
  signal: AbortSignal,
  tools: GeminiToolSchema[],
  onChunk: (chunk: string) => StreamEvent,
): AsyncGenerator<{ type: 'event'; event: StreamEvent } | { type: 'tool_calls'; toolCalls: NativeToolCall[] }> {
  const apiKey = storeApiKey('gemini')
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')

  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const client = new GoogleGenerativeAI(apiKey)
  const genModel = client.getGenerativeModel({
    model,
    systemInstruction: nativeSystemPrompt(systemPrompt),
    ...(tools.length > 0 ? { tools: [{ functionDeclarations: tools }] } : {}),
  })
  const result = await genModel.generateContentStream(
    {
      contents: messagesToGemini(messages),
    },
    { signal },
  )

  const toolCalls: NativeToolCall[] = []
  for await (const part of result.stream) {
    for (const call of extractGeminiFunctionCalls(part)) {
      toolCalls.push(call)
    }
    const delta = part.text()
    if (delta) yield { type: 'event', event: onChunk(delta) }
  }
  if (toolCalls.length > 0) yield { type: 'tool_calls', toolCalls }
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
      if (
        block &&
        typeof block === 'object' &&
        (block as any).type === 'tool_use'
      ) {
        return `[tool_use:${(block as any).name}]\n${JSON.stringify((block as any).input ?? {})}`
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function createNativeAssistantMessage(
  model: string,
  text: string,
  toolCalls: NativeToolCall[] = [],
): AssistantMessage {
  const content = [
    ...(text ? [{ type: 'text', text }] : []),
    ...toolCalls.map(call => ({
      type: 'tool_use',
      id: call.id || randomUUID(),
      name: call.name,
      input: call.input,
    })),
  ]
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
      content: content.length > 0 ? content : [{ type: 'text', text: '(no content)' }],
      context_management: null,
    },
  } as AssistantMessage
}

type OpenAIToolSchema = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
    strict?: boolean
  }
}

type OpenAIResponsesToolSchema = {
  type: 'function'
  name: string
  description?: string
  parameters: Record<string, unknown>
  strict?: boolean
}

type GeminiToolSchema = {
  name: string
  description?: string
  parameters: Record<string, unknown>
}

async function buildNativeToolSchemas(
  tools: Tools,
  options: NativeToolOptions,
  model: string,
): Promise<{ openai: OpenAIToolSchema[]; gemini: GeminiToolSchema[] }> {
  const enabledTools = tools.filter(tool => tool.isEnabled())
  const schemas = await Promise.all(
    enabledTools.map(tool =>
      toolToAPISchema(tool, {
        getToolPermissionContext: options.getToolPermissionContext,
        tools,
        agents: options.agents,
        allowedAgentTypes: options.allowedAgentTypes,
        model,
      }),
    ),
  )

  const functionTools = schemas.filter(
    schema => 'input_schema' in schema && 'name' in schema,
  ) as Array<{
    name: string
    description?: string
    input_schema?: Record<string, unknown>
    strict?: boolean
  }>

  return {
    openai: functionTools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema || { type: 'object' },
        ...(tool.strict ? { strict: true } : {}),
      },
    })),
    gemini: functionTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: sanitizeGeminiSchema(tool.input_schema || { type: 'object' }),
    })),
  }
}

function nativeSystemPrompt(systemPrompt: SystemPrompt): string {
  return [
    systemPrompt.join('\n\n'),
    'You are running inside Claudex. You have access to CLI tools such as Read, Write, Edit, Bash, Glob, Grep, and other listed tools. When a task requires reading files, executing terminal commands, creating folders, editing files, or inspecting the workspace, call the appropriate tool directly. Do not ask the user to paste files or run shell commands unless no matching tool is available.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function parseToolArguments(value: string): Record<string, unknown> {
  if (!value.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {}
  } catch {
    return {}
  }
}

function sanitizeGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(schema || { type: 'object' }))
  stripUnsupportedSchemaFields(clone)
  return clone
}

function stripUnsupportedSchemaFields(value: unknown): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) stripUnsupportedSchemaFields(item)
    return
  }
  const obj = value as Record<string, unknown>
  delete obj.$schema
  delete obj.additionalProperties
  delete obj.default
  for (const child of Object.values(obj)) stripUnsupportedSchemaFields(child)
}

function extractGeminiFunctionCalls(part: unknown): NativeToolCall[] {
  const response = (part as any)?.response
  const parts = response?.candidates?.[0]?.content?.parts ?? []
  return parts
    .map((p: any) => p?.functionCall)
    .filter(Boolean)
    .map((call: any) => ({
      id: randomUUID(),
      name: String(call.name || ''),
      input:
        call.args && typeof call.args === 'object' && !Array.isArray(call.args)
          ? call.args
          : {},
    }))
    .filter((call: NativeToolCall) => call.name)
}

function toResponsesTool(tool: OpenAIToolSchema): OpenAIResponsesToolSchema {
  return {
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    ...(tool.function.strict ? { strict: true } : {}),
  }
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
