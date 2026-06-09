import { randomUUID } from 'crypto'
import { setTimeout as sleep } from 'timers/promises'
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
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '../../constants/prompts.js'
import { FRONTEND_DESIGN_PROMPT } from '../../skills/bundled/frontendDesign.js'
import { CORE_QUALITY_STANDARDS } from '../../constants/qualityStandards.js'
import Conf from 'conf'

const directStore = new Conf({
  projectName: 'claudex',
  configName: 'direct-providers',
})

const DEFAULT_NATIVE_HISTORY_MESSAGES = 100
const DEFAULT_NATIVE_TOOL_DESCRIPTION_CHARS = 10_000
const DEFAULT_NATIVE_TOOL_RESULT_CHARS = 100_000

const nativeToolSchemaCache = new Map<
  string,
  Promise<{ openai: OpenAIToolSchema[]; gemini: GeminiToolSchema[] }>
>()

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
    const nativeMessages = limitNativeHistory(messages)
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
      for await (const event of streamOpenAI(route.model, nativeMessages, systemPrompt, signal, nativeTools.openai, onChunk)) {
        if (event.type === 'tool_calls') toolCalls = event.toolCalls
        else yield event.event
      }
    } else {
      for await (const event of streamGemini(route.model, nativeMessages, systemPrompt, signal, nativeTools.gemini, onChunk)) {
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
  const stream = await retryOnTransient(async () =>
    client.chat.completions.create(
      {
        model,
        stream: true,
        messages: [
          { role: 'system', content: nativeSystemPrompt(systemPrompt, 'openai') },
          ...messagesToOpenAIChat(messages),
        ],
        ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
      },
      { signal },
    ),
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
      input: normalizeNativeToolInput(call.name, parseToolArguments(call.arguments)),
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

  const input = messagesToOpenAIResponses(messages)

  const body = JSON.stringify({
    model,
    input,
    instructions: nativeSystemPrompt(systemPrompt, 'openai'),
    stream: true,
    store: false,
    ...(tools.length > 0 ? { tools: tools.map(toResponsesTool), tool_choice: 'auto' } : {}),
  })

  const url = isOAuthKey
    ? 'https://chatgpt.com/backend-api/codex/responses'
    : 'https://api.openai.com/v1/responses'

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers,
    body,
    signal,
  })

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
          const id = String(event.item_id || '')
          if (!id) continue
          const existing = toolCallChunks.get(id) ?? { id, name: '', arguments: '' }
          existing.arguments += String(event.delta || '')
          toolCallChunks.set(id, existing)
        } else if (
          (event.type === 'response.output_item.added' ||
            event.type === 'response.output_item.done') &&
          event.item?.type === 'function_call'
        ) {
          const id = String(event.item.id || '')
          if (!id) continue
          const existing = toolCallChunks.get(id) ?? { id, name: '', arguments: '' }
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
    .filter(call => call.name && call.id)
    .map(call => ({
      id: call.id,
      name: call.name,
      input: normalizeNativeToolInput(call.name, parseToolArguments(call.arguments)),
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
    systemInstruction: nativeSystemPrompt(systemPrompt, 'gemini'),
    ...(tools.length > 0 ? { tools: [{ functionDeclarations: tools }] } : {}),
  })
  const result = await retryOnTransient(() =>
    genModel.generateContentStream(
      {
        contents: messagesToGemini(messages),
      },
      { signal },
    ),
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

function messagesToOpenAIChat(messages: Message[]): Array<Record<string, unknown>> {
  return messages.flatMap(message => {
    const role = (message as any).message?.role
    if (role !== 'user' && role !== 'assistant') return []
    const content = (message as any).message?.content

    if (role === 'assistant') {
      const text = contentToText(content)
      const toolCalls = contentToToolCalls(content)
      if (toolCalls.length === 0 && !text) return []
      return [
        {
          role: 'assistant',
          content: text || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
      ]
    }

    const toolResults = contentToToolResults(content)
    if (toolResults.length > 0) {
      return toolResults.map(result => ({
        role: 'tool',
        tool_call_id: result.id,
        content: result.output,
      }))
    }

    const text = contentToText(content)
    if (!text) return []
    return [{ role: 'user', content: text }]
  })
}

function messagesToOpenAIResponses(messages: Message[]): Array<Record<string, unknown>> {
  const functionCallIds = new Set<string>()

  const items = messages.flatMap(message => {
    const role = (message as any).message?.role
    if (role !== 'user' && role !== 'assistant') return []
    const content = (message as any).message?.content

    if (role === 'assistant') {
      const text = contentToText(content)
      const result: Record<string, unknown>[] = []
      if (text) result.push({ role: 'assistant', content: text })
      for (const call of contentToToolCalls(content)) {
        const callId = String(call.id)
        functionCallIds.add(callId)
        result.push({
          type: 'function_call',
          call_id: callId,
          name: (call.function as any).name,
          arguments: (call.function as any).arguments,
        })
      }
      return result
    }

    const toolResults = contentToToolResults(content)
    if (toolResults.length > 0) {
      return toolResults
        .filter(result => functionCallIds.has(result.id))
        .map(result => ({
          type: 'function_call_output',
          call_id: result.id,
          output: result.output,
        }))
    }

    const text = contentToText(content)
    if (!text) return []
    return [{ role: 'user', content: text }]
  })

  return items
}

function messagesToGemini(messages: Message[]): Array<Record<string, unknown>> {
  const toolNamesById = new Map<string, string>()
  const converted: Array<Record<string, unknown>> = []

  for (const message of messages) {
    const role = (message as any).message?.role
    if (role !== 'user' && role !== 'assistant') continue
    const content = (message as any).message?.content
    const text = contentToText(content)
    const toolCalls = contentToGeminiFunctionCalls(content)
    for (const call of contentToToolUseMetadata(content)) {
      toolNamesById.set(call.id, call.name)
    }
    const toolResults = contentToGeminiFunctionResponses(
      content,
      toolNamesById,
    )
    const parts = [
      ...(text ? [{ text }] : []),
      ...toolCalls,
      ...toolResults,
    ]
    if (parts.length === 0) continue
    converted.push({
      role: role === 'assistant' ? 'model' : 'user',
      parts,
    })
  }

  return converted
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
        return ''
      }
      if (
        block &&
        typeof block === 'object' &&
        (block as any).type === 'tool_use'
      ) {
        return ''
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function contentToToolCalls(content: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(content)) return []
  return content
    .filter(
      block =>
        block &&
        typeof block === 'object' &&
        (block as any).type === 'tool_use' &&
        (block as any).name &&
        (block as any).id,
    )
    .map(block => ({
      id: String((block as any).id),
      type: 'function',
      function: {
        name: String((block as any).name),
        arguments: JSON.stringify((block as any).input ?? {}),
      },
    }))
}

function contentToToolResults(
  content: unknown,
): Array<{ id: string; output: string }> {
  if (!Array.isArray(content)) return []
  return content
    .filter(
      block =>
        block &&
        typeof block === 'object' &&
        (block as any).type === 'tool_result' &&
        (block as any).tool_use_id,
    )
    .map(block => ({
      id: String((block as any).tool_use_id),
      output: truncateNativeToolResult(
        contentToText((block as any).content) ||
          stringifyToolResult((block as any).content),
      ),
    }))
}

function contentToToolUseMetadata(
  content: unknown,
): Array<{ id: string; name: string }> {
  if (!Array.isArray(content)) return []
  return content
    .filter(
      block =>
        block &&
        typeof block === 'object' &&
        (block as any).type === 'tool_use' &&
        (block as any).id &&
        (block as any).name,
    )
    .map(block => ({
      id: String((block as any).id),
      name: String((block as any).name),
    }))
}

function contentToGeminiFunctionCalls(content: unknown): Array<Record<string, unknown>> {
  return contentToToolCalls(content).map(call => ({
    functionCall: {
      name: (call.function as any).name,
      args: parseToolArguments(String((call.function as any).arguments || '{}')),
    },
  }))
}

function contentToGeminiFunctionResponses(
  content: unknown,
  toolNamesById: Map<string, string>,
): Array<Record<string, unknown>> {
  return contentToToolResults(content).map(result => ({
    functionResponse: {
      name: toolNamesById.get(result.id) || 'tool_result',
      response: {
        result: result.output,
      },
    },
  }))
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === 'string') return content
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
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
      stop_reason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
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
  const cacheKey = [
    model,
    options.allowedAgentTypes?.join(',') ?? '',
    tools.map(tool => `${tool.name}:${tool.isEnabled() ? '1' : '0'}`).join('|'),
  ].join('::')
  const cached = nativeToolSchemaCache.get(cacheKey)
  if (cached) return cached

  const buildPromise = buildNativeToolSchemasUncached(tools, options, model)
  nativeToolSchemaCache.set(cacheKey, buildPromise)
  return buildPromise
}

async function buildNativeToolSchemasUncached(
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
        description: compactNativeToolDescription(tool.description),
        parameters: compactNativeInputSchema(tool.input_schema || { type: 'object' }),
        ...(tool.strict ? { strict: true } : {}),
      },
    })),
    gemini: functionTools.map(tool => ({
      name: tool.name,
      description: compactNativeToolDescription(tool.description),
      parameters: sanitizeGeminiSchema(
        compactNativeInputSchema(tool.input_schema || { type: 'object' }),
      ),
    })),
  }
}

function nativeSystemPrompt(
  systemPrompt: SystemPrompt,
  provider: 'openai' | 'gemini',
): string {
  const providerName = provider === 'openai' ? 'OpenAI' : 'Gemini'
  const identity = `You are Claudex, a terminal AI assistant powered by ${providerName}. You are running inside Claudex — a TUI that gives you access to every enabled CLI tool listed in the tool schema, including file tools, shell tools, editing tools, search tools, agents, and skill/internal-prompt tools. When a task requires reading files, executing terminal commands, creating folders, editing files, inspecting the workspace, using an internal prompt, or applying a bundled skill, call the appropriate tool directly. Do not ask the user to paste files or run shell commands unless no matching tool is available.`

  const providerSpecificTips =
    provider === 'openai'
      ? `\n\n### OpenAI-Specific Tips\n- Set \`strict: true\` on structured output schemas for reliable JSON parsing\n- Response format: prefer concise, structured responses\n- OpenAI models benefit from explicit step-by-step reasoning in tool selection`
      : `\n\n### Gemini-Specific Tips\n- Gemini works best with clear, flat tool schemas (avoid deep nesting)\n- Include explicit examples in tool descriptions for better tool selection\n- Gemini performs well with parallel tool calls — maximize parallelism`

  const qualityPrompt =
    `\n\n## Quality Standards (Claude Code Level)\n\n` +
    `${CORE_QUALITY_STANDARDS}` +
    `\n\n### Plan Mode (Always On)\n` +
    `Before implementing anything non-trivial:\n` +
    `1. Explore the project structure (Glob)\n` +
    `2. Read relevant files to understand existing patterns\n` +
    `3. Search for similar implementations (Grep)\n` +
    `4. Only then write code\n` +
    `\n### Tool Chaining\n` +
    `- Read first, edit second, read again to verify\n` +
    `- When you need to understand a component, read its file AND its imports\n` +
    `- After editing, always read the file back to verify the edit was correct\n` +
    `- Chain: Read -> Edit -> Read -> Lint/Build` +
    providerSpecificTips +
    `\n\n### Skill Execution (MANDATORY — NOT Optional)\n` +
    `When the user's request matches a skill's purpose, you MUST execute that skill BEFORE writing code. This is required, not a suggestion. Do not skip skills. Do not implement directly without invoking the relevant skill first.\n\n` +
    `Skill matching examples:\n` +
    `- User asks "test this" or "run tests" → MUST call /test first\n` +
    `- User asks "review my code" or "review this PR" → MUST call /review first\n` +
    `- User asks "refactor X" → MUST call /refactor first\n` +
    `- User asks "architect this" or "how should I structure" → MUST call /architecture first\n` +
    `- User asks for "docs" or "documentation" → MUST call /docs first\n` +
    `- User asks to "commit" or "write a commit message" → MUST call /commit first\n` +
    `- User seems new ("first time", "getting started") → MUST call /onboard first\n` +
    `- User asks about project structure, specs → MUST call /spec first\n` +
    `- Task involves frontend → MUST call /codex-frontend-master or /frontend-design first\n` +
    `- User asks to set project rules → MUST call /instructions first\n` +
    `- User says "continue where I left off" → MUST call /session first\n` +
    `- User asks Claudex to learn, remember routing lessons, or improve skill suggestions → MUST call /learn first\n` +
    `- User asks to check Claudex itself → MUST call /self-test first\n` +
    `- User asks about APIs, endpoints, or REST/GraphQL designs → MUST call /api-design first\n` +
    `- User asks about databases, schemas, migrations, or SQL queries → MUST call /database first\n` +
    `- User asks about deployment, Docker, CI/CD, or infrastructure → MUST call /deploy first\n` +
    `- User asks about auth, security, or OWASP → MUST call /backend-security first\n` +
    `- User asks about AI integration, LLMs, OpenAI, or Gemini → MUST call /ai-provider first` +
    `\n\n### When You Need Help\n` +
    `- /debug — debugging session issues\n` +
    `- /simplify — review code quality and efficiency\n` +
    `- /review — PR-level code review\n` +
    `- /test — write and run tests\n` +
    `- /architecture — system design decisions\n` +
    `- /refactor — safe multi-step refactoring\n` +
    `- /spec — Spec-Driven Development (requirements, design, tasks)\n` +
    `- /instructions — manage custom project rules in .claudex/instructions/\n` +
    `- /session — save/resume session state across sessions\n` +
    `- /learn — manage adaptive learning, RAG memory, and smart skill routing\n` +
    `- /commit — conventional commits and changelog\n` +
    `- /onboard — new user setup\n` +
    `- /v0-frontend — Vercel v0-inspired frontend generation (opinionated stack, complete code)\n` +
    `- /api-design — REST/GraphQL API design, OpenAPI specs, endpoint patterns\n` +
    `- /database — schema design, migrations, query optimization, data modeling\n` +
    `- /deploy — CI/CD pipelines, Docker, deployment strategies, infrastructure\n` +
    `- /backend-security — auth, OWASP Top 10, secrets management, API hardening\n` +
    `- /ai-provider — LLM integration (OpenAI, Gemini, Anthropic), streaming, RAG\n` +
    `- /self-test — run Claudex's own quality checks\n` +
    `- AskUserQuestion — when you need clarification\n` +
    `\n### Destructive Operations\n` +
    `- Always read a file before editing it\n` +
    `- Prefer Edit tool over Write for small changes (Edit is reversible)\n` +
    `- Use Bash only when no dedicated tool exists for the task\n` +
    `- Ask before running destructive terminal commands`

  const frontendStandardsPrompt =
    `\n\n## Frontend Standards (Embedded — Always Active)\n\n` +
    `### frontend-design skill (official Claude Code, always active)\n` +
    `${FRONTEND_DESIGN_PROMPT}`

  // Process dynamic boundary: split into static prefix + dynamic suffix
  const boundaryIdx = systemPrompt.indexOf(SYSTEM_PROMPT_DYNAMIC_BOUNDARY)
  if (boundaryIdx !== -1) {
    const staticPart = systemPrompt.slice(0, boundaryIdx).join('\n\n')
    const dynamicPart = systemPrompt.slice(boundaryIdx + 1).join('\n\n')
    return [
      identity,
      staticPart,
      qualityPrompt + frontendStandardsPrompt,
      dynamicPart,
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  return [
    identity,
    ...systemPrompt,
    claudeQualityInstructions + frontendStandardsPrompt,
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

function limitNativeHistory(messages: Message[]): Message[] {
  const limit = readPositiveIntEnv(
    'CLAUDEX_NATIVE_HISTORY_MESSAGES',
    DEFAULT_NATIVE_HISTORY_MESSAGES,
  )
  if (messages.length <= limit) return messages

  // Compression: summarize old turns (everything before the last 10 messages)
  const keepFresh = 10
  const oldMessages = messages.slice(0, -keepFresh)
  const freshMessages = messages.slice(-keepFresh)

  const summary = compressHistory(oldMessages, keepFresh)
  if (!summary) return messages.slice(-limit)

  const compressedMsg = {
    message: {
      role: 'user' as const,
      content: [
        {
          type: 'text' as const,
          text: `[Earlier conversation summary: ${summary}]`,
        },
      ],
    },
  } as unknown as Message
  return [compressedMsg, ...freshMessages].slice(-limit)
}

function compressHistory(messages: Message[], maxTurns: number): string | null {
  // Focus on user requests and assistant text content — skip tool noise
  const entries: string[] = []
  for (const msg of messages.slice(-maxTurns)) {
    const role = (msg as any).message?.role
    const content = (msg as any).message?.content
    if (!content || !Array.isArray(content)) continue
    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        const text = block.text.trim()
        if (text.length > 0) {
          entries.push(`${role}: ${text.slice(0, 200)}`)
        }
      }
    }
  }
  if (entries.length === 0) return null
  return entries.join(' | ').slice(0, 2000)
}

function compactNativeToolDescription(description: string | undefined): string | undefined {
  if (!description) return description
  const limit = readPositiveIntEnv(
    'CLAUDEX_NATIVE_TOOL_DESCRIPTION_CHARS',
    DEFAULT_NATIVE_TOOL_DESCRIPTION_CHARS,
  )
  const normalized = description.replace(/\s+/g, ' ').trim()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, limit).trimEnd()}...`
}

function compactNativeInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(schema || { type: 'object' }))
  stripVerboseSchemaFields(clone)
  return clone
}

function truncateNativeToolResult(output: string): string {
  const limit = readPositiveIntEnv(
    'CLAUDEX_NATIVE_TOOL_RESULT_CHARS',
    DEFAULT_NATIVE_TOOL_RESULT_CHARS,
  )
  if (output.length <= limit) return output

  // Smart truncation: try to preserve structure (JSON arrays/objects, key sections)
  const truncated = output.slice(0, limit)

  // If it looks like JSON, try to close the outer structure
  if (output.trimStart().startsWith('[')) {
    const lastBracket = truncated.lastIndexOf('}')
    if (lastBracket > limit * 0.5) {
      return `${truncated.slice(0, lastBracket + 1)}\n  // ... ${output.length - limit} more items truncated\n]`
    }
  }
  if (output.trimStart().startsWith('{')) {
    const lastField = truncated.lastIndexOf('",')
    if (lastField > limit * 0.5) {
      return `${truncated.slice(0, lastField + 2)}\n  // ... ${output.length - limit} more fields truncated\n}`
    }
  }

  // Multi-line: keep first + last sections, collapse middle
  const lines = truncated.split('\n')
  if (lines.length > 10) {
    const firstPart = lines.slice(0, 5).join('\n')
    const lastPart = lines.slice(-5).join('\n')
    return `${firstPart}\n  ...[${output.length - limit} more chars truncated]...\n${lastPart}`
  }

  // Fallback: plain truncation with context hint
  return `${truncated}\n\n[Claudex truncated this tool result for speed/token usage (${output.length} chars total, showing first ${limit}). Use Read with offset/limit or a narrower command if more content is needed.]`
}

async function fetchWithRetry(
  url: string,
  options: RequestInit & { signal: AbortSignal },
  maxRetries = 2,
): Promise<Response> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options)
      if (response.ok) return response
      if (response.status === 429 || response.status >= 500) {
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * 2 ** attempt + Math.random() * 1000, 10_000)
          await sleep(delay)
          continue
        }
      }
      const text = await response.text()
      throw new Error(`Responses API error (${response.status}): ${text}`)
    } catch (e) {
      if (options.signal?.aborted) throw e
      if (e instanceof Error && e.message?.includes('Responses API error')) throw e
      lastError = e instanceof Error ? e : new Error(String(e))
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * 2 ** attempt + Math.random() * 1000, 10_000)
        await sleep(delay)
        continue
      }
    }
  }
  throw lastError || new Error('fetchWithRetry failed')
}

async function retryOnTransient<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
): Promise<T> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      if (!isTransientError(lastError)) throw e
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * 2 ** attempt + Math.random() * 1000, 10_000)
        await sleep(delay)
      }
    }
  }
  throw lastError || new Error('retryOnTransient failed')
}

function isTransientError(e: Error): boolean {
  const msg = e.message || ''
  return (
    msg.includes('429') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('rate_limit') ||
    msg.includes('timeout') ||
    msg.includes('Too Many Requests') ||
    msg.includes('Service Unavailable') ||
    msg.includes('Internal Server Error') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('socket hang up')
  )
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeNativeToolInput(
  toolName: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = { ...input }
  if (toolName === 'Read') {
    if (normalized.pages === '' || normalized.pages === null) {
      delete normalized.pages
    }
    if (normalized.offset === null) delete normalized.offset
    if (normalized.limit === null) delete normalized.limit
  }
  return normalized
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

function stripVerboseSchemaFields(value: unknown): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) stripVerboseSchemaFields(item)
    return
  }
  const obj = value as Record<string, unknown>
  delete obj['$schema']
  delete obj.markdownDescription
  delete obj.examples
  for (const child of Object.values(obj)) stripVerboseSchemaFields(child)
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
          ? normalizeNativeToolInput(String(call.name || ''), call.args)
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
