import { applyProxyEnv, getBaseUrl, getProxyConfig, normalizeProvider, NVIDIA_BASE_URL } from './config.js'

// SDKs se cargan bajo demanda: importar los tres al inicio penaliza el
// arranque de cada `axolot chat` aunque solo se use un provider.

function emitReasoning(delta, options) {
  const value = delta?.reasoning_content ?? delta?.reasoning
  if (typeof value === 'string' && value && options.onThinking) {
    options.onThinking(value)
  }
}

export class ClaudeProvider {
  constructor({ apiKey }) {
    applyProxyEnv('claude')
    const proxy = getProxyConfig('claude')
    this.apiKey = proxy?.authToken || apiKey
    this.customBase = (!proxy?.baseURL && getBaseUrl('claude')) || ''
  }

  async streamResponse(prompt, model, onChunk, options = {}) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    this.client ??= new Anthropic({
      apiKey: this.apiKey,
      ...(this.customBase ? { baseURL: this.customBase } : {}),
    })
    const stream = await this.client.messages.create(
      {
        model,
        max_tokens: options.maxTokens ?? 4096,
        system: options.system,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
      },
      { signal: options.signal },
    )

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta?.type === 'thinking_delta' &&
        event.delta.thinking
      ) {
        options.onThinking?.(event.delta.thinking)
      }
      if (
        event.type === 'content_block_delta' &&
        event.delta?.type === 'text_delta' &&
        event.delta.text
      ) {
        onChunk(event.delta.text)
      }
    }
  }
}

export class OpenAIProvider {
  constructor({ apiKey }) {
    this.apiKey = apiKey
    this.customBase = getBaseUrl('openai')
  }

  async streamResponse(prompt, model, onChunk, options = {}) {
    const { default: OpenAI } = await import('openai')
    this.client ??= new OpenAI({
      apiKey: this.apiKey,
      ...(this.customBase ? { baseURL: this.customBase } : {}),
    })
    const messages = []
    if (options.system) {
      messages.push({ role: 'system', content: options.system })
    }
    messages.push({ role: 'user', content: prompt })

    const stream = await this.client.chat.completions.create(
      {
        model,
        messages,
        stream: true,
      },
      { signal: options.signal },
    )

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta
      emitReasoning(delta, options)
      if (delta?.content) onChunk(delta.content)
    }
  }
}

function isOpenRouterKey(key) {
  return typeof key === 'string' && key.startsWith('sk-or-v1-')
}

// Campo específico de la API oficial de DeepSeek — endpoints de terceros
// (NVIDIA NIM, gateways...) pueden rechazarlo o ignorarlo. Configurable con
// DEEPSEEK_THINKING=off|low|medium|high (default: high, como la TUI).
function deepSeekThinkingBody(customBase) {
  if (customBase) return {}
  const mode = (process.env.DEEPSEEK_THINKING || 'high').toLowerCase()
  if (mode === 'off' || mode === 'false' || mode === 'none') return {}
  return { extra_body: { thinking: { type: mode } } }
}

export class DeepSeekProvider {
  constructor({ apiKey }) {
    // A custom base URL (NVIDIA NIM, a gateway, etc.) takes priority and uses
    // the model name as typed — prefixing rules only apply to known endpoints.
    this.apiKey = apiKey
    this.customBase = getBaseUrl('deepseek')
    this.isOpenRouter = !this.customBase && isOpenRouterKey(apiKey)
    this.baseURL =
      this.customBase ||
      (this.isOpenRouter
        ? 'https://openrouter.ai/api/v1'
        : 'https://api.deepseek.com')
  }

  async streamResponse(prompt, model, onChunk, options = {}) {
    const { default: OpenAI } = await import('openai')
    this.client ??= new OpenAI({ apiKey: this.apiKey, baseURL: this.baseURL })
    const messages = []
    if (options.system) {
      messages.push({ role: 'system', content: options.system })
    }
    messages.push({ role: 'user', content: prompt })

    const actualModel = this.isOpenRouter
      ? `deepseek/${model}`
      : model

    const stream = await this.client.chat.completions.create(
      {
        model: actualModel,
        messages,
        stream: true,
        max_tokens: 16384,
        ...deepSeekThinkingBody(this.customBase),
      },
      { signal: options.signal },
    )

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta
      emitReasoning(delta, options)
      if (delta?.content) onChunk(delta.content)
    }
  }
}

export class MiniMaxProvider {
  constructor({ apiKey }) {
    this.apiKey = apiKey
    this.baseURL = getBaseUrl('minimax') || 'https://api.minimax.io/v1'
  }

  async streamResponse(prompt, model, onChunk, options = {}) {
    const messages = []
    if (options.system) {
      messages.push({ role: 'system', content: options.system })
    }
    messages.push({ role: 'user', content: prompt })

    const body = JSON.stringify({ model, messages, stream: true, max_tokens: 16384 })

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body,
      signal: options.signal,
      keepalive: false,
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`MiniMax error (${response.status}): ${errText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''
    let hasContent = false

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

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
          emitReasoning(parsed.choices?.[0]?.delta, options)
          const text =
            parsed.choices?.[0]?.delta?.content ??
            parsed.choices?.[0]?.text ??
            parsed.choices?.[0]?.delta?.text
          if (text) {
            hasContent = true
            onChunk(String(text))
          }
        } catch {}
      }
    }

    if (!hasContent) {
      const nsBody = JSON.stringify({ model, messages, max_tokens: 16384 })
      const nsRes = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: nsBody,
        signal: options.signal,
        keepalive: false,
      })
      if (nsRes.ok) {
        const result = await nsRes.json()
        const text = result?.choices?.[0]?.message?.content
        if (text) onChunk(text)
      }
    }
  }
}

// GLM (Zhipu) and Kimi (Moonshot) are plain OpenAI-compatible chat endpoints.
// They default to NVIDIA NIM's universal endpoint (one key unlocks many models)
// but honor a custom base URL like every other provider.
export class OpenAICompatibleProvider {
  constructor({ apiKey, provider, defaultBase }) {
    this.apiKey = apiKey
    this.baseURL = getBaseUrl(provider) || defaultBase
  }

  async streamResponse(prompt, model, onChunk, options = {}) {
    const { default: OpenAI } = await import('openai')
    this.client ??= new OpenAI({ apiKey: this.apiKey, baseURL: this.baseURL })
    const messages = []
    if (options.system) {
      messages.push({ role: 'system', content: options.system })
    }
    messages.push({ role: 'user', content: prompt })

    const stream = await this.client.chat.completions.create(
      {
        model,
        messages,
        stream: true,
        max_tokens: options.maxTokens ?? 16384,
      },
      { signal: options.signal },
    )

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta
      emitReasoning(delta, options)
      if (delta?.content) onChunk(delta.content)
    }
  }
}

export class GeminiProvider {
  constructor({ apiKey }) {
    this.apiKey = apiKey
    this.customBase = getBaseUrl('gemini')
  }

  async streamResponse(prompt, model, onChunk, options = {}) {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    this.client ??= new GoogleGenerativeAI(this.apiKey)
    const genModel = this.client.getGenerativeModel(
      {
        model,
        systemInstruction: options.system,
      },
      this.customBase ? { baseUrl: this.customBase } : undefined,
    )

    const result = await genModel.generateContentStream(
      {
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
      },
      { signal: options.signal },
    )

    for await (const chunk of result.stream) {
      // Los modelos thinking de Gemini marcan el razonamiento con
      // `thought: true`; chunk.text() lo mezclaría todo.
      const parts = chunk.candidates?.[0]?.content?.parts
      if (Array.isArray(parts) && parts.length > 0) {
        for (const part of parts) {
          if (typeof part?.text !== 'string' || !part.text) continue
          if (part.thought === true) options.onThinking?.(part.text)
          else onChunk(part.text)
        }
      } else {
        const text = chunk.text()
        if (text) onChunk(text)
      }
    }
  }
}

export function createProvider(provider, { apiKey }) {
  const normalized = normalizeProvider(provider)

  if (!apiKey) {
    throw new Error(`Falta API key para ${normalized}`)
  }

  switch (normalized) {
    case 'claude':
      return new ClaudeProvider({ apiKey })
    case 'openai':
      return new OpenAIProvider({ apiKey })
    case 'gemini':
      return new GeminiProvider({ apiKey })
    case 'deepseek':
      return new DeepSeekProvider({ apiKey })
    case 'minimax':
      return new MiniMaxProvider({ apiKey })
    case 'glm':
      return new OpenAICompatibleProvider({ apiKey, provider: 'glm', defaultBase: NVIDIA_BASE_URL })
    case 'kimi':
      return new OpenAICompatibleProvider({ apiKey, provider: 'kimi', defaultBase: NVIDIA_BASE_URL })
    case 'nvidia':
      return new OpenAICompatibleProvider({ apiKey, provider: 'nvidia', defaultBase: NVIDIA_BASE_URL })
    default:
      throw new Error(`Proveedor no soportado: ${provider}`)
  }
}
