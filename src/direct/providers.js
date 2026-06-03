import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { normalizeProvider } from './config.js'

export class ClaudeProvider {
  constructor({ apiKey }) {
    this.client = new Anthropic({ apiKey })
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
    default:
      throw new Error(`Proveedor no soportado: ${provider}`)
  }
}
