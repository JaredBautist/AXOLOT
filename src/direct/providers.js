import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { applyProxyEnv, getProxyConfig, normalizeProvider } from './config.js'

export class ClaudeProvider {
  constructor({ apiKey }) {
    applyProxyEnv('claude')
    const proxy = getProxyConfig('claude')
    const clientOptions = proxy?.authToken
      ? { authToken: proxy.authToken }
      : { apiKey }
    this.client = new Anthropic(clientOptions)
  }

  async streamResponse(prompt, model, onChunk, options = {}) {
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
    this.client = new OpenAI({ apiKey })
  }

  async streamResponse(prompt, model, onChunk, options = {}) {
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
      const text = chunk.choices?.[0]?.delta?.content
      if (text) onChunk(text)
    }
  }
}

function isOpenRouterKey(key) {
  return typeof key === 'string' && key.startsWith('sk-or-v1-')
}

export class DeepSeekProvider {
  constructor({ apiKey }) {
    this.isOpenRouter = isOpenRouterKey(apiKey)
    const baseURL = this.isOpenRouter
      ? 'https://openrouter.ai/api/v1'
      : 'https://api.deepseek.com'
    this.client = new OpenAI({ apiKey, baseURL })
  }

  async streamResponse(prompt, model, onChunk, options = {}) {
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
        extra_body: { thinking: 'high' },
      },
      { signal: options.signal },
    )

    for await (const chunk of stream) {
      const text = chunk.choices?.[0]?.delta?.content
      if (text) onChunk(text)
    }
  }
}

export class MiniMaxProvider {
  constructor({ apiKey }) {
    this.apiKey = apiKey
    this.baseURL = 'https://api.minimax.io/v1'
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
    let debugged = false

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

          if (!debugged) {
            debugged = true
            const choice0 = parsed.choices?.[0]
            const keys = Object.keys(parsed).join(', ')
            const choiceKeys = choice0 ? Object.keys(choice0).join(', ') : 'none'
            const delta = choice0?.delta
            const deltaKeys = delta ? Object.keys(delta).join(', ') : 'none'
            console.error(`[MiniMax SSE] topKeys: ${keys} | choiceKeys: ${choiceKeys} | deltaKeys: ${deltaKeys}`)
          }

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

export class GeminiProvider {
  constructor({ apiKey }) {
    this.client = new GoogleGenerativeAI(apiKey)
  }

  async streamResponse(prompt, model, onChunk, options = {}) {
    const genModel = this.client.getGenerativeModel({
      model,
      systemInstruction: options.system,
    })

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
      const text = chunk.text()
      if (text) onChunk(text)
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
    default:
      throw new Error(`Proveedor no soportado: ${provider}`)
  }
}
