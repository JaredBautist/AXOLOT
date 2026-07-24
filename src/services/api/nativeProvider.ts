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
import type { ThinkingConfig } from '../../utils/thinking.js'
import { toolToAPISchema } from '../../utils/api.js'
import { createAssistantAPIErrorMessage } from '../../utils/messages.js'
import type { SystemPrompt } from '../../utils/systemPromptType.js'
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '../../constants/prompts.js'
import { selectSmartModel, detectAvailableProviders, profileProject, inferTaskTypes } from '../../services/orchestration/smartDefaults.js'
import {
  buildNativeFrontendPromptModule,
  buildNativeProviderPromptModule,
  buildNativeSelfReviewModule,
  buildNativeSkillPromptModule,
  buildNativeTaskPromptModule,
  inferNativePromptTask,
  shouldIncludeNativeFrontendPrompt,
} from './nativePromptModules.js'
import Conf from 'conf'

const directStore = new Conf({
  projectName: 'axolot',
  configName: 'direct-providers',
})

const DEFAULT_NATIVE_HISTORY_MESSAGES = 100
const DEFAULT_NATIVE_TOOL_DESCRIPTION_CHARS = 10_000
const DEFAULT_NATIVE_TOOL_RESULT_CHARS = 100_000

const nativeToolSchemaCache = new Map<
  string,
  Promise<{ openai: OpenAIToolSchema[]; gemini: GeminiToolSchema[] }>
>()

type NativeProvider = 'openai' | 'gemini' | 'deepseek' | 'minimax' | 'glm' | 'kimi' | 'nvidia'

// GLM (Zhipu) and Kimi (Moonshot) default to NVIDIA NIM's universal, OpenAI-
// compatible endpoint — one nvapi- key unlocks many models.
const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1'

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

type NativeChunkKind = 'text' | 'thinking'

type NativeEmitChunk = (kind: NativeChunkKind, chunk: string) => StreamEvent[]

export function getNativeProviderRoute(model: string): NativeRoute | null {
  const raw = String(model || '').trim()
  const lower = raw.toLowerCase()

  if (lower.startsWith('openai/')) {
    return { provider: 'openai', model: raw.slice('openai/'.length) }
  }

  if (lower.startsWith('gemini/') || lower.startsWith('google/')) {
    return { provider: 'gemini', model: raw.slice(raw.indexOf('/') + 1) }
  }

  if (lower.startsWith('deepseek/')) {
    return { provider: 'deepseek', model: raw.slice('deepseek/'.length) }
  }

  if (lower.startsWith('minimax/')) {
    return { provider: 'minimax', model: raw.slice('minimax/'.length) }
  }

  if (lower.startsWith('glm/')) {
    return { provider: 'glm', model: raw.slice('glm/'.length) }
  }

  if (lower.startsWith('kimi/')) {
    return { provider: 'kimi', model: raw.slice('kimi/'.length) }
  }

  // "nvidia/<org>/<model>" — the universal NVIDIA NIM passthrough ("your
  // favorite model"): any model in the catalog, routed to NVIDIA as-is.
  if (lower.startsWith('nvidia/')) {
    return { provider: 'nvidia', model: raw.slice('nvidia/'.length) }
  }

  const envProvider = process.env.AXOLOT_NATIVE_PROVIDER?.toLowerCase()
  if (
    envProvider === 'openai' || envProvider === 'gemini' || envProvider === 'deepseek' ||
    envProvider === 'minimax' || envProvider === 'glm' || envProvider === 'kimi' ||
    envProvider === 'nvidia'
  ) {
    return { provider: envProvider, model: raw }
  }

  // Smart default: if AXOLOT_AUTO_NATIVE is set and no explicit provider
  // matched, try to auto-select a native provider based on project context.
  if (process.env.AXOLOT_AUTO_NATIVE === '1' || process.env.AXOLOT_AUTO_NATIVE === 'true') {
    return getSmartNativeRoute()
  }

  return null
}

function getSmartNativeRoute(): NativeRoute | null {
  const available = detectAvailableProviders()
  const providers = Object.keys(available)
  if (providers.length === 0) return null

  const profile = profileProject()
  const tasks = inferTaskTypes(profile)
  const budgetMode = process.env.AXOLOT_BUDGET_MODE || 'balanced'

  // Use the first inferred task type to select a model
  const result = selectSmartModel(tasks[0], {
    budgetMode: budgetMode as any,
    apiKeys: available,
  })

  const providerMap: Record<string, NativeProvider> = {
    openai: 'openai',
    deepseek: 'deepseek',
    gemini: 'gemini',
    minimax: 'minimax',
  }

  const nativeProvider = providerMap[result.provider]
  if (!nativeProvider) return null

  return { provider: nativeProvider, model: result.model.id }
}

export async function* queryNativeProvider({
  messages,
  systemPrompt,
  signal,
  model,
  tools,
  options,
  thinkingConfig,
}: {
  messages: Message[]
  systemPrompt: SystemPrompt
  signal: AbortSignal
  model: string
  tools: Tools
  options: NativeToolOptions
  thinkingConfig?: ThinkingConfig
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

    let text = ''
    let thinkingText = ''
    let toolCalls: NativeToolCall[] = []
    let blockIndex = -1
    let currentBlock: 'text' | 'thinking' | null = null

    // Reasoning models interleave thinking and answer chunks; open a new
    // content block whenever the chunk kind changes so the TUI renders both.
    const emitChunk = (kind: NativeChunkKind, chunk: string): StreamEvent[] => {
      const events: StreamEvent[] = []
      if (currentBlock !== kind) {
        if (currentBlock !== null) {
          events.push(fakeStreamEvent({ type: 'content_block_stop', index: blockIndex }))
        }
        blockIndex++
        events.push(
          fakeStreamEvent({
            type: 'content_block_start',
            index: blockIndex,
            content_block:
              kind === 'text'
                ? { type: 'text', text: '' }
                : { type: 'thinking', thinking: '', signature: '' },
          }),
        )
        currentBlock = kind
      }
      if (kind === 'text') {
        text += chunk
        events.push(
          fakeStreamEvent({
            type: 'content_block_delta',
            index: blockIndex,
            delta: { type: 'text_delta', text: chunk },
          }),
        )
      } else {
        thinkingText += chunk
        events.push(
          fakeStreamEvent({
            type: 'content_block_delta',
            index: blockIndex,
            delta: { type: 'thinking_delta', thinking: chunk },
          }),
        )
      }
      return events
    }

    if (route.provider === 'openai') {
      for await (const event of streamOpenAI(route.model, nativeMessages, systemPrompt, signal, nativeTools.openai, emitChunk)) {
        if (event.type === 'tool_calls') toolCalls = event.toolCalls
        else yield event.event
      }
    } else if (route.provider === 'deepseek') {
      for await (const event of streamDeepSeek(route.model, nativeMessages, systemPrompt, signal, nativeTools.openai, emitChunk, thinkingConfig)) {
        if (event.type === 'tool_calls') toolCalls = event.toolCalls
        else yield event.event
      }
    } else if (route.provider === 'minimax') {
      for await (const event of streamMiniMax(route.model, nativeMessages, systemPrompt, signal, nativeTools.openai, emitChunk)) {
        if (event.type === 'tool_calls') toolCalls = event.toolCalls
        else yield event.event
      }
    } else if (route.provider === 'glm' || route.provider === 'kimi' || route.provider === 'nvidia') {
      for await (const event of streamNvidiaHosted(route.provider, route.model, nativeMessages, systemPrompt, signal, nativeTools.openai, emitChunk)) {
        if (event.type === 'tool_calls') toolCalls = event.toolCalls
        else yield event.event
      }
    } else {
      for await (const event of streamGemini(route.model, nativeMessages, systemPrompt, signal, nativeTools.gemini, emitChunk)) {
        if (event.type === 'tool_calls') toolCalls = event.toolCalls
        else yield event.event
      }
    }

    if (currentBlock !== null) {
      yield fakeStreamEvent({ type: 'content_block_stop', index: blockIndex })
    } else {
      yield fakeStreamEvent({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      })
      yield fakeStreamEvent({ type: 'content_block_stop', index: 0 })
    }
    yield fakeStreamEvent({
      type: 'message_delta',
      delta: { stop_reason: toolCalls.length > 0 ? 'tool_use' : 'end_turn', stop_sequence: null },
      usage: {
        output_tokens: Math.max(1, Math.ceil((text.length + thinkingText.length) / 4)),
      },
    })
    yield fakeStreamEvent({ type: 'message_stop' })

    yield createNativeAssistantMessage(
      model,
      text,
      toolCalls,
      estimateNativeInputTokens(nativeMessages, systemPrompt),
      thinkingText.length,
    )
  } catch (error) {
    if (signal.aborted) return
    const classified = classifyNativeError(error instanceof Error ? error : new Error(String(error)))
    const errorText = formatError(error)
    const customBase = storeBaseUrl(route.provider)
    const notFoundHint =
      customBase && errorText.includes('404')
        ? ` — "${route.model}" may not exist on ${customBase}. Run /model to pick one from that endpoint's list.`
        : ''
    yield createAssistantAPIErrorMessage({
      content: `Provider error (${route.provider}/${classified}): ${errorText}${notFoundHint}`,
      apiError: classified === 'auth_error' ? 'invalid_api_key' : 'api_error',
      error: classified,
    })
  }
}

// Providers hosted behind NVIDIA NIM's universal endpoint — one nvapi- key
// unlocks all of them, so they share NVIDIA_API_KEY (and each other's stored key).
const NVIDIA_HOSTED = ['glm', 'kimi', 'deepseek', 'nvidia']

function sharedNvidiaKey(): string {
  const env = process.env.NVIDIA_API_KEY
  if (env) return env
  for (const p of NVIDIA_HOSTED) {
    const stored = directStore.get(`apiKeys.${p}`) as string
    if (stored) return stored
  }
  return ''
}

function storeApiKey(provider: string): string {
  const envVar =
    provider === 'openai' ? 'OPENAI_API_KEY' :
    provider === 'deepseek' ? 'DEEPSEEK_API_KEY' :
    provider === 'minimax' ? 'MINIMAX_API_KEY' :
    provider === 'glm' ? 'GLM_API_KEY' :
    provider === 'kimi' ? 'KIMI_API_KEY' :
    provider === 'nvidia' ? 'NVIDIA_API_KEY' :
    'GEMINI_API_KEY'
  const raw =
    process.env[envVar] ||
    (directStore.get(`apiKeys.${provider}`) as string) ||
    (NVIDIA_HOSTED.includes(provider) ? sharedNvidiaKey() : '') ||
    ''
  // Keep only visible ASCII: a stray newline/space/zero-width char from a paste
  // ends up in the Authorization header value and the runtime rejects it
  // ("invalid header value"). Real API keys are always printable ASCII.
  return String(raw).replace(/[^\x21-\x7E]/g, '')
}

// User-configured API endpoint (e.g. NVIDIA NIM, OpenRouter, a local gateway)
// that overrides the provider's official base URL. Env var wins over the
// stored value; empty string means "use the provider default".
function storeBaseUrl(provider: string): string {
  const envVar =
    provider === 'openai' ? 'OPENAI_BASE_URL' :
    provider === 'deepseek' ? 'DEEPSEEK_BASE_URL' :
    provider === 'minimax' ? 'MINIMAX_BASE_URL' :
    provider === 'glm' ? 'GLM_BASE_URL' :
    provider === 'kimi' ? 'KIMI_BASE_URL' :
    provider === 'nvidia' ? 'NVIDIA_BASE_URL' :
    'GEMINI_BASE_URL'
  const value =
    process.env[envVar] ||
    (directStore.get(`baseUrls.${provider}`) as string) ||
    ''
  return String(value).trim().replace(/\/+$/, '')
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
  emitChunk: NativeEmitChunk,
): AsyncGenerator<{ type: 'event'; event: StreamEvent } | { type: 'tool_calls'; toolCalls: NativeToolCall[] }> {
  const apiKey = await ensureOpenAIToken()
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured')

  const isOAuthKey =
    (directStore.get('credentialType.openai') as string) === 'oauth'

  if (isOAuthKey) {
    yield* streamOpenAIResponses(model, messages, systemPrompt, signal, tools, emitChunk, apiKey)
  } else {
    yield* streamOpenAIChat(model, messages, systemPrompt, signal, tools, emitChunk, apiKey)
  }
}

async function* streamOpenAIChat(
  model: string,
  messages: Message[],
  systemPrompt: SystemPrompt,
  signal: AbortSignal,
  tools: OpenAIToolSchema[],
  emitChunk: NativeEmitChunk,
  apiKey: string,
): AsyncGenerator<{ type: 'event'; event: StreamEvent } | { type: 'tool_calls'; toolCalls: NativeToolCall[] }> {
  const { default: OpenAI } = await import('openai')
  const customBase = storeBaseUrl('openai')
  const client = new OpenAI({ apiKey, ...(customBase ? { baseURL: customBase } : {}) })
  const toolCallChunks = new Map<number, { id: string; name: string; arguments: string }>()
  const stream = await retryOnTransient(async () =>
    client.chat.completions.create(
      {
        model,
        stream: true,
        messages: [
          { role: 'system', content: nativeSystemPrompt(systemPrompt, 'openai', messages, model) },
          ...messagesToOpenAIChat(messages, true),
        ],
        ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
      },
      { signal },
    ),
  )

  for await (const part of stream) {
    const rawDelta = part.choices?.[0]?.delta as Record<string, unknown> | undefined
    const reasoning = extractReasoningDelta(rawDelta)
    if (reasoning) {
      for (const event of emitChunk('thinking', reasoning)) yield { type: 'event', event }
    }
    const delta = part.choices?.[0]?.delta?.content
    if (delta) {
      for (const event of emitChunk('text', delta)) yield { type: 'event', event }
    }

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
  emitChunk: NativeEmitChunk,
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
    instructions: nativeSystemPrompt(systemPrompt, 'openai', messages, model),
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

  // Stall watchdog: if no data arrives for 60s, cancel instead of hanging forever
  let streamTimeout: NodeJS.Timeout | null = null
  const resetStreamTimeout = () => {
    if (streamTimeout) clearTimeout(streamTimeout)
    streamTimeout = setTimeout(() => {
      streamTimeout = null
      reader.cancel('OpenAI Responses stream stalled').catch(() => {})
    }, 60_000)
  }
  resetStreamTimeout()

  try {
  let sawDone = false
  while (!sawDone) {
    const { done, value } = await reader.read()
    if (done) break
    resetStreamTimeout()

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6)
      if (data === '[DONE]') {
        // Don't return here: the accumulated tool calls below must still be flushed.
        sawDone = true
        break
      }

      try {
        const event = JSON.parse(data)
        if (
          (event.type === 'response.reasoning_summary_text.delta' ||
            event.type === 'response.reasoning_text.delta') &&
          event.delta
        ) {
          for (const streamEvent of emitChunk('thinking', String(event.delta))) {
            yield { type: 'event', event: streamEvent }
          }
        }
        if (event.type === 'response.output_text.delta' && event.delta) {
          for (const streamEvent of emitChunk('text', String(event.delta))) {
            yield { type: 'event', event: streamEvent }
          }
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
          // call_id (not item.id) is what function_call_output must reference
          // when the conversation is replayed — keep it as the canonical id.
          if (event.item.call_id) existing.id = String(event.item.call_id)
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
  } finally {
    if (streamTimeout) clearTimeout(streamTimeout)
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

async function* streamGemini(
  model: string,
  messages: Message[],
  systemPrompt: SystemPrompt,
  signal: AbortSignal,
  tools: GeminiToolSchema[],
  emitChunk: NativeEmitChunk,
): AsyncGenerator<{ type: 'event'; event: StreamEvent } | { type: 'tool_calls'; toolCalls: NativeToolCall[] }> {
  const apiKey = storeApiKey('gemini')
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')

  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const client = new GoogleGenerativeAI(apiKey)
  const customBase = storeBaseUrl('gemini')
  const genModel = client.getGenerativeModel(
    {
      model,
      systemInstruction: nativeSystemPrompt(systemPrompt, 'gemini', messages, model),
      ...(tools.length > 0 ? { tools: [{ functionDeclarations: tools }] } : {}),
    },
    customBase ? { baseUrl: customBase } : undefined,
  )
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
    // Gemini thinking models mark reasoning parts with `thought: true`; the
    // SDK's part.text() concatenates everything, so split them manually.
    const parts = getGeminiChunkParts(part)
    let emittedFromParts = false
    for (const p of parts) {
      if (typeof p?.text !== 'string' || !p.text) continue
      emittedFromParts = true
      const kind: NativeChunkKind = p.thought === true ? 'thinking' : 'text'
      for (const event of emitChunk(kind, p.text)) yield { type: 'event', event }
    }
    if (!emittedFromParts) {
      const delta = part.text()
      if (delta) {
        for (const event of emitChunk('text', delta)) yield { type: 'event', event }
      }
    }
  }
  if (toolCalls.length > 0) yield { type: 'tool_calls', toolCalls }
}

function getDeepSeekThinking(
  thinkingConfig?: ThinkingConfig,
  customBase?: string,
): Record<string, unknown> {
  // `thinking` is a field of DeepSeek's official API. Third-party OpenAI-compatible
  // endpoints (NVIDIA NIM, gateways...) reject unknown top-level fields with a
  // 400 (no body), so omit it whenever a custom base URL is in use.
  if (customBase) return {}
  // The user's session-level thinking toggle wins over the env default.
  if (thinkingConfig?.type === 'disabled') return {}
  const mode = (process.env.DEEPSEEK_THINKING || 'high').toLowerCase()
  if (mode === 'off' || mode === 'false' || mode === 'none') return {}
  const envBudget = readPositiveIntEnv('DEEPSEEK_THINKING_BUDGET', 0)
  const budget =
    thinkingConfig?.type === 'enabled' && thinkingConfig.budgetTokens > 0
      ? thinkingConfig.budgetTokens
      : envBudget
  const thinking: Record<string, unknown> = { type: mode }
  if (budget > 0) thinking.budget_tokens = budget
  return { thinking }
}

async function* streamDeepSeek(
  model: string,
  messages: Message[],
  systemPrompt: SystemPrompt,
  signal: AbortSignal,
  tools: OpenAIToolSchema[],
  emitChunk: NativeEmitChunk,
  thinkingConfig?: ThinkingConfig,
): AsyncGenerator<{ type: 'event'; event: StreamEvent } | { type: 'tool_calls'; toolCalls: NativeToolCall[] }> {
  const apiKey = storeApiKey('deepseek')
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not configured')

  // A custom base URL (NVIDIA NIM, a gateway, etc.) takes priority and uses
  // the model name as typed — prefixing rules only apply to known endpoints.
  const customBase = storeBaseUrl('deepseek')
  const isOpenRouter = !customBase && apiKey.startsWith('sk-or-v1-')
  const baseURL = customBase || (isOpenRouter ? 'https://openrouter.ai/api/v1' : 'https://api.deepseek.com')
  const actualModel = isOpenRouter ? `deepseek/${model}` : model

  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey, baseURL })
  const toolCallChunks = new Map<number, { id: string; name: string; arguments: string }>()
  // Only attach extra_body when there's actually something to send — a bare
  // `extra_body: {}` is itself an unknown field to strict gateways (400 no body).
  const thinkingBody = getDeepSeekThinking(thinkingConfig, customBase)
  const stream = await retryOnTransient(async () =>
    client.chat.completions.create(
      {
        model: actualModel,
        stream: true,
        messages: [
          { role: 'system', content: nativeSystemPrompt(systemPrompt, 'deepseek', messages, actualModel) },
          ...messagesToOpenAIChat(messages),
        ],
        ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
        ...(Object.keys(thinkingBody).length > 0 ? { extra_body: thinkingBody } : {}),
      },
      { signal },
    ),
  )

  for await (const part of stream) {
    const rawDelta = part.choices?.[0]?.delta as Record<string, unknown> | undefined
    const reasoning = extractReasoningDelta(rawDelta)
    if (reasoning) {
      for (const event of emitChunk('thinking', reasoning)) yield { type: 'event', event }
    }
    const delta = part.choices?.[0]?.delta?.content
    if (delta) {
      for (const event of emitChunk('text', delta)) yield { type: 'event', event }
    }

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

// Generic OpenAI-compatible streamer for NVIDIA-hosted providers (GLM, Kimi).
// Same shape as streamDeepSeek minus the DeepSeek-only `thinking` extra_body;
// base URL defaults to NVIDIA's universal endpoint but honors a custom override.
async function* streamNvidiaHosted(
  provider: 'glm' | 'kimi' | 'nvidia',
  model: string,
  messages: Message[],
  systemPrompt: SystemPrompt,
  signal: AbortSignal,
  tools: OpenAIToolSchema[],
  emitChunk: NativeEmitChunk,
): AsyncGenerator<{ type: 'event'; event: StreamEvent } | { type: 'tool_calls'; toolCalls: NativeToolCall[] }> {
  const apiKey = storeApiKey(provider)
  if (!apiKey) throw new Error(`${provider.toUpperCase()}_API_KEY is not configured`)

  const baseURL = storeBaseUrl(provider) || NVIDIA_BASE_URL

  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey, baseURL })
  const toolCallChunks = new Map<number, { id: string; name: string; arguments: string }>()
  const stream = await retryOnTransient(async () =>
    client.chat.completions.create(
      {
        model,
        stream: true,
        messages: [
          { role: 'system', content: nativeSystemPrompt(systemPrompt, provider, messages, model) },
          ...messagesToOpenAIChat(messages),
        ],
        ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
      },
      { signal },
    ),
  )

  for await (const part of stream) {
    const rawDelta = part.choices?.[0]?.delta as Record<string, unknown> | undefined
    const reasoning = extractReasoningDelta(rawDelta)
    if (reasoning) {
      for (const event of emitChunk('thinking', reasoning)) yield { type: 'event', event }
    }
    const delta = part.choices?.[0]?.delta?.content
    if (delta) {
      for (const event of emitChunk('text', delta)) yield { type: 'event', event }
    }

    for (const call of part.choices?.[0]?.delta?.tool_calls ?? []) {
      const index = call.index ?? 0
      const existing = toolCallChunks.get(index) ?? { id: '', name: '', arguments: '' }
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

async function* streamMiniMax(
  model: string,
  messages: Message[],
  systemPrompt: SystemPrompt,
  signal: AbortSignal,
  tools: OpenAIToolSchema[],
  emitChunk: NativeEmitChunk,
): AsyncGenerator<{ type: 'event'; event: StreamEvent } | { type: 'tool_calls'; toolCalls: NativeToolCall[] }> {
  const apiKey = storeApiKey('minimax')
  if (!apiKey) throw new Error('MINIMAX_API_KEY is not configured')

  const miniMaxBase = storeBaseUrl('minimax') || 'https://api.minimax.io/v1'
  const miniMaxEndpoint = `${miniMaxBase}/chat/completions`

  const requestBody: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: nativeSystemPrompt(systemPrompt, 'minimax', messages, model) },
      ...messagesToMiniMaxChat(messages),
    ],
    max_tokens: 16384,
    ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
  }

  const response = await fetchMiniMaxWithRetry(miniMaxEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ ...requestBody, stream: true }),
    signal,
    keepalive: false,
    timeout: 30_000,
  })

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  const toolCallChunks = new Map<string, { id: string; name: string; arguments: string }>()

  // Stream stall watchdog: if no data arrives for 60s, abort
  let streamTimeout: NodeJS.Timeout | null = null
  const resetStreamTimeout = () => {
    if (streamTimeout) clearTimeout(streamTimeout)
    streamTimeout = setTimeout(() => {
      streamTimeout = null
      reader.cancel('MiniMax stream stalled').catch(() => {})
    }, 60_000)
  }
  resetStreamTimeout()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    resetStreamTimeout()

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const rawData = trimmed.slice(5).trim()
      if (!rawData || rawData === '[DONE]') continue

      try {
        const parsed = JSON.parse(rawData)

        const reasoning = extractReasoningDelta(
          parsed.choices?.[0]?.delta as Record<string, unknown> | undefined,
        )
        if (reasoning) {
          for (const event of emitChunk('thinking', reasoning)) yield { type: 'event', event }
        }

        const delta =
          parsed.choices?.[0]?.delta?.content ??
          parsed.choices?.[0]?.text ??
          parsed.choices?.[0]?.delta?.text
        if (delta) {
          fullText += String(delta)
          for (const event of emitChunk('text', String(delta))) yield { type: 'event', event }
        }

        for (const call of parsed.choices?.[0]?.delta?.tool_calls ?? []) {
          const id = String(call.index ?? '0')
          const existing = toolCallChunks.get(id) ?? { id, name: '', arguments: '' }
          if (call.id) existing.id = call.id
          if (call.function?.name) existing.name = call.function.name
          if (call.function?.arguments) existing.arguments += call.function.arguments
          toolCallChunks.set(id, existing)
        }
      } catch {
        // skip malformed JSON
      }
    }
  }

  // Clean up stream watchdog
  if (streamTimeout) clearTimeout(streamTimeout)

  if (!fullText && !toolCallChunks.size) {
    const nonStreamBody = JSON.stringify(requestBody)
    try {
      const nsResponse = await fetchMiniMaxWithRetry(miniMaxEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: nonStreamBody,
        signal,
        keepalive: false,
        timeout: 15_000,
      })
      const nsResult = await nsResponse.json()
      const nsText = nsResult?.choices?.[0]?.message?.content
      if (nsText) {
        fullText = nsText
        for (const event of emitChunk('text', String(nsText))) yield { type: 'event', event }
      }
    } catch (fallbackError) {
      // The stream produced nothing and the fallback failed too — surface the
      // error instead of ending the turn with silent empty output.
      if (!signal.aborted) throw fallbackError
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

function messagesToOpenAIChat(
  messages: Message[],
  includeImages = false,
): Array<Record<string, unknown>> {
  const raw: Array<Record<string, unknown>> = messages.flatMap(message => {
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
      const converted: Array<Record<string, unknown>> = toolResults.map(result => ({
        role: 'tool',
        tool_call_id: result.id,
        content: result.output,
      }))
      if (includeImages) {
        const images = contentToToolResultImages(content)
        if (images.length > 0) {
          converted.push({
            role: 'user',
            content: [
              { type: 'text', text: '[Image(s) attached to the preceding tool result]' },
              ...images.map(img => ({
                type: 'image_url',
                image_url: { url: `data:${img.mediaType};base64,${img.data}` },
              })),
            ],
          })
        }
      }
      return converted
    }

    const text = contentToText(content)
    if (!text) return []
    return [{ role: 'user', content: text }]
  })

  // Drop orphaned tool results (their tool_call was compacted away). OpenAI
  // and MiniMax both hard-reject a `tool` message with no matching call.
  const validToolCallIds = new Set<string>()
  for (const msg of raw) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const call of msg.tool_calls as Array<{ id: string }>) {
        if (call.id) validToolCallIds.add(call.id)
      }
    }
  }
  return raw.filter(msg => {
    if (msg.role === 'tool' && msg.tool_call_id && !validToolCallIds.has(msg.tool_call_id as string)) {
      return false
    }
    return true
  })
}

/**
 * MiniMax uses the OpenAI-compatible chat format; orphan filtering now lives
 * in messagesToOpenAIChat so every OpenAI-shaped provider benefits.
 */
function messagesToMiniMaxChat(messages: Message[]): Array<Record<string, unknown>> {
  return messagesToOpenAIChat(messages)
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
      const outputs: Array<Record<string, unknown>> = toolResults
        .filter(result => functionCallIds.has(result.id))
        .map(result => ({
          type: 'function_call_output',
          call_id: result.id,
          output: result.output,
        }))
      const images = contentToToolResultImages(content)
      if (outputs.length > 0 && images.length > 0) {
        outputs.push({
          role: 'user',
          content: [
            { type: 'input_text', text: '[Image(s) attached to the preceding tool result]' },
            ...images.map(img => ({
              type: 'input_image',
              image_url: `data:${img.mediaType};base64,${img.data}`,
            })),
          ],
        })
      }
      return outputs
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
    // functionResponse parts can't carry images — attach screenshots from
    // tool results as inlineData in the same user turn (Gemini is multimodal).
    const images =
      role === 'user' && toolResults.length > 0
        ? contentToToolResultImages(content)
        : []
    const parts = [
      ...(text ? [{ text }] : []),
      ...toolCalls,
      ...toolResults,
      ...images.map(img => ({
        inlineData: { mimeType: img.mediaType, data: img.data },
      })),
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

/**
 * Extract base64 images (e.g. screenshots) from tool_result blocks. Native
 * tool-role messages can only carry text, so vision-capable providers get the
 * images re-injected as an adjacent user message instead of dropping them.
 */
function contentToToolResultImages(
  content: unknown,
): Array<{ mediaType: string; data: string }> {
  if (!Array.isArray(content)) return []
  const images: Array<{ mediaType: string; data: string }> = []
  for (const block of content) {
    if (!block || typeof block !== 'object' || (block as any).type !== 'tool_result') continue
    const inner = (block as any).content
    if (!Array.isArray(inner)) continue
    for (const innerBlock of inner) {
      if (
        innerBlock &&
        typeof innerBlock === 'object' &&
        (innerBlock as any).type === 'image' &&
        (innerBlock as any).source?.type === 'base64' &&
        (innerBlock as any).source?.data
      ) {
        images.push({
          mediaType: String((innerBlock as any).source.media_type || 'image/png'),
          data: String((innerBlock as any).source.data),
        })
      }
    }
  }
  return images
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

/**
 * Reasoning-capable OpenAI-compatible APIs expose the thinking stream under
 * different delta fields: DeepSeek/MiniMax use `reasoning_content`, OpenRouter
 * and some proxies use `reasoning`.
 */
function extractReasoningDelta(delta: Record<string, unknown> | undefined): string {
  if (!delta) return ''
  const value = delta.reasoning_content ?? delta.reasoning
  return typeof value === 'string' ? value : ''
}

/**
 * Rough input-token estimate (chars/4) so context tracking and auto-compact
 * see real growth instead of the 0 that native APIs would otherwise report.
 */
function estimateNativeInputTokens(
  messages: Message[],
  systemPrompt: SystemPrompt,
): number {
  let chars = systemPrompt.join('\n').length
  for (const message of messages) {
    const content = (message as any).message?.content
    if (typeof content === 'string') {
      chars += content.length
      continue
    }
    try {
      chars += JSON.stringify(content ?? '').length
    } catch {
      // unserializable content — skip
    }
  }
  return Math.max(1, Math.ceil(chars / 4))
}

function createNativeAssistantMessage(
  model: string,
  text: string,
  toolCalls: NativeToolCall[] = [],
  inputTokensEstimate = 0,
  thinkingChars = 0,
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
        input_tokens: inputTokensEstimate,
        output_tokens: Math.max(1, Math.ceil((text.length + thinkingChars) / 4)),
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
  provider: 'openai' | 'gemini' | 'deepseek' | 'minimax' | 'glm' | 'kimi' | 'nvidia',
  messages: Message[] = [],
  model = '',
): string {
  const providerName =
    provider === 'openai' ? 'OpenAI' :
    provider === 'deepseek' ? 'DeepSeek' :
    provider === 'minimax' ? 'MiniMax' :
    provider === 'glm' ? 'GLM' :
    provider === 'kimi' ? 'Kimi' :
    provider === 'nvidia' ? 'NVIDIA' :
    'Gemini'
  const poweredBy = model ? `${providerName} (model: ${model})` : providerName
  const identity = [
    `You are Axolot, an elite terminal AI assistant powered by ${poweredBy}.`,
    ``,
    `Your mission: solve the user's problems with precision, intelligence, and boldness. Use the available tools autonomously, verify your work, and report only real results.`,
    ``,
    `### Core Directive`,
    `- Think before you act; keep internal reasoning private and user-facing output concise.`,
    `- Read current code before changing it, then verify edits with real checks.`,
    `- Use relevant skills when they match the task, but avoid noisy skill-registry dumps.`,
    `- Do not repeat identical tool calls; change strategy when blocked.`,
  ].join('\n')

  const taskType = inferNativePromptTask(messages)
  const dynamicModules = [
    buildNativeProviderPromptModule(provider),
    buildNativeTaskPromptModule(taskType),
    buildNativeSkillPromptModule(taskType),
    ...(shouldIncludeNativeFrontendPrompt(taskType, messages)
      ? [buildNativeFrontendPromptModule()]
      : []),
    buildNativeSelfReviewModule(taskType),
  ].join('\n\n')

  const boundaryIdx = systemPrompt.indexOf(SYSTEM_PROMPT_DYNAMIC_BOUNDARY)
  if (boundaryIdx !== -1) {
    const staticPart = systemPrompt.slice(0, boundaryIdx).join('\n\n')
    const dynamicPart = systemPrompt.slice(boundaryIdx + 1).join('\n\n')
    // dynamicModules vary with the inferred task type of the LAST user
    // message — keep them at the very end so the stable prefix (identity +
    // staticPart) stays byte-identical across turns and OpenAI/DeepSeek
    // automatic prefix caching keeps hitting.
    return [identity, staticPart, dynamicPart, dynamicModules]
      .filter(Boolean)
      .join('\n\n')
  }

  return [identity, ...systemPrompt, dynamicModules]
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
    'AXOLOT_NATIVE_HISTORY_MESSAGES',
    DEFAULT_NATIVE_HISTORY_MESSAGES,
  )
  if (messages.length <= limit) return messages

  // Keep a generous fresh window and summarize EVERYTHING older than it —
  // dropping old turns wholesale loses which files were read/edited and what
  // the user originally asked for.
  const keepFresh = Math.min(
    Math.max(20, Math.floor(limit / 3)),
    Math.max(1, messages.length - 1),
  )
  const cut = findCleanHistoryCut(messages, messages.length - keepFresh)
  const oldMessages = messages.slice(0, cut)
  const freshMessages = messages.slice(cut)

  const summary = compressHistory(oldMessages)
  if (!summary) return freshMessages

  const compressedMsg = {
    message: {
      role: 'user' as const,
      content: [
        {
          type: 'text' as const,
          text: `<system-reminder>Summary of the earlier part of this conversation (older turns were compacted to fit the context window):\n${summary}\n</system-reminder>`,
        },
      ],
    },
  } as unknown as Message
  return [compressedMsg, ...freshMessages]
}

/**
 * Find a cut index at or after `preferred` where the fresh window starts with
 * a message that is NOT a tool_result — cutting between a tool_use and its
 * tool_result orphans the result (hard 400 on strict providers).
 */
function findCleanHistoryCut(messages: Message[], preferred: number): number {
  for (let i = preferred; i < messages.length; i++) {
    const content = (messages[i] as any).message?.content
    const hasToolResult =
      Array.isArray(content) &&
      content.some(
        (block: any) => block && typeof block === 'object' && block.type === 'tool_result',
      )
    if (!hasToolResult) return i
  }
  return preferred
}

const DEFAULT_NATIVE_HISTORY_SUMMARY_CHARS = 12_000

function compressHistory(messages: Message[]): string | null {
  // Summarize ALL old messages: user/assistant text plus a compact record of
  // tool activity (which tools ran on what), so the model keeps a map of the
  // session instead of amnesia about everything before the fresh window.
  const entries: string[] = []
  for (const msg of messages) {
    const role = (msg as any).message?.role
    const content = (msg as any).message?.content
    if (typeof content === 'string') {
      const text = content.trim()
      if (text) entries.push(`${role}: ${text.slice(0, 300)}`)
      continue
    }
    if (!content || !Array.isArray(content)) continue
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      if (block.type === 'text' && typeof block.text === 'string') {
        const text = block.text.trim()
        if (text.length > 0) entries.push(`${role}: ${text.slice(0, 300)}`)
      } else if (block.type === 'tool_use' && block.name) {
        entries.push(`${role} called ${block.name}(${summarizeToolInput(block.input)})`)
      } else if (block.type === 'tool_result') {
        const output =
          contentToText(block.content) || stringifyToolResult(block.content)
        const trimmed = output.trim().replace(/\s+/g, ' ')
        if (trimmed) entries.push(`  -> ${trimmed.slice(0, 150)}`)
      }
    }
  }
  if (entries.length === 0) return null

  const maxChars = readPositiveIntEnv(
    'AXOLOT_NATIVE_HISTORY_SUMMARY_CHARS',
    DEFAULT_NATIVE_HISTORY_SUMMARY_CHARS,
  )
  const joined = entries.join('\n')
  if (joined.length <= maxChars) return joined
  // Recent entries carry more weight — keep the tail and note the elision.
  return `[...oldest turns elided...]\n${joined.slice(-maxChars)}`
}

function summarizeToolInput(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const obj = input as Record<string, unknown>
  // Prefer the fields that identify WHAT was touched.
  const keyFields = ['file_path', 'notebook_path', 'path', 'command', 'pattern', 'query', 'url', 'prompt']
  for (const field of keyFields) {
    const value = obj[field]
    if (typeof value === 'string' && value) {
      return `${field}: ${value.slice(0, 120).replace(/\s+/g, ' ')}`
    }
  }
  try {
    return JSON.stringify(obj).slice(0, 120)
  } catch {
    return ''
  }
}

function compactNativeToolDescription(description: string | undefined): string | undefined {
  if (!description) return description
  const limit = readPositiveIntEnv(
    'AXOLOT_NATIVE_TOOL_DESCRIPTION_CHARS',
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
    'AXOLOT_NATIVE_TOOL_RESULT_CHARS',
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
  return `${truncated}\n\n[Axolot truncated this tool result for speed/token usage (${output.length} chars total, showing first ${limit}). Use Read with offset/limit or a narrower command if more content is needed.]`
}

async function fetchMiniMaxWithRetry(
  url: string,
  options: RequestInit & { signal: AbortSignal; timeout?: number },
  maxRetries = 3,
): Promise<Response> {
  const timeout = options.timeout ?? 30_000
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(new DOMException('MiniMax timeout', 'TimeoutError')), timeout)
    const combinedSignal = AbortSignal.any?.([options.signal, controller.signal]) ?? options.signal

    try {
      const response = await fetch(url, { ...options, signal: combinedSignal })
      clearTimeout(timeoutId)

      if (response.ok) return response

      const text = await response.text().catch(() => '')
      const isTransient =
        response.status === 429 ||
        response.status >= 500

      if (isTransient && attempt < maxRetries) {
        const delay = Math.min(1500 * 2 ** attempt + Math.random() * 1000, 15_000)
        await sleep(delay)
        continue
      }

      throw new Error(`MiniMax error (${response.status}): ${text.slice(0, 500)}`)
    } catch (e) {
      clearTimeout(timeoutId)
      if (options.signal?.aborted) throw e

      const err = e instanceof Error ? e : new Error(String(e))
      // Don't retry auth or non-transient errors
      if (err.message?.includes('MiniMax error (401)') || err.message?.includes('MiniMax error (403)')) throw err

      lastError = err
      if (attempt < maxRetries) {
        const delay = Math.min(1500 * 2 ** attempt + Math.random() * 1000, 15_000)
        await sleep(delay)
      }
    }
  }

  throw lastError || new Error('MiniMax request failed after retries')
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
    msg.includes('socket hang up') ||
    // Google Gemini specific transient errors
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('DEADLINE_EXCEEDED') ||
    msg.includes('INTERNAL') ||
    msg.includes('quota_exceeded') ||
    msg.includes('Aborted') ||
    msg.includes('CANCELLED')
  )
}

function classifyNativeError(e: Error): string {
  const msg = e.message || ''
  if (msg.includes('429') || msg.includes('rate_limit') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota_exceeded')) return 'rate_limit'
  if (msg.includes('401') || msg.includes('403') || msg.includes('api key') || msg.includes('API_KEY')) return 'auth_error'
  if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('DEADLINE_EXCEEDED') || msg.includes('AbortError')) return 'timeout'
  if (msg.includes('400') && (msg.includes('context') || msg.includes('length') || msg.includes('max_tokens') || msg.includes('prompt'))) return 'prompt_too_long'
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504') || msg.includes('UNAVAILABLE') || msg.includes('INTERNAL')) return 'server_error'
  if (msg.includes('ECONNRESET') || msg.includes('socket hang up') || msg.includes('fetch failed') || msg.includes('network')) return 'connection_error'
  return 'unknown'
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
  // Keep constraint fields (pattern, min/max, enum, defaults, examples):
  // they are cheap in tokens and dropping them makes models emit invalid
  // tool arguments that Anthropic-path models would never produce.
  for (const child of Object.values(obj)) stripVerboseSchemaFields(child)
}

function getGeminiChunkParts(chunk: unknown): any[] {
  // Stream chunks expose candidates directly; aggregated results nest them
  // under .response. Accept both shapes.
  const source = (chunk as any)?.candidates ? chunk : (chunk as any)?.response
  return (source as any)?.candidates?.[0]?.content?.parts ?? []
}

function extractGeminiFunctionCalls(part: unknown): NativeToolCall[] {
  const parts = getGeminiChunkParts(part)
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
