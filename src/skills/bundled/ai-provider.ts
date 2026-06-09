import { registerBundledSkill } from '../bundledSkills.js'

const AI_PROVIDER_SKILL_PROMPT = `# AI Provider Integration Skill — OpenAI, Gemini, LangChain & More

Use this skill when integrating with AI model APIs (OpenAI, Google Gemini, Anthropic Claude, etc.), building LLM-powered features, or working with AI SDKs and frameworks.

## Process

1. **Choose the provider** — based on model capabilities, latency, cost, data residency
2. **Set up client** — SDK installation, authentication, error handling
3. **Design the prompt** — system prompt, user message format, few-shot examples
4. **Handle output** — parsing, validation, structured output schemas
5. **Implement best practices** — retries, streaming, rate limiting, caching

## Provider SDK Patterns

### OpenAI
\`\`\`typescript
import OpenAI from 'openai'
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'system', content: 'You are helpful.' }],
  response_format: { type: 'json_object' },
  temperature: 0.7,
})
\`\`\`

### Google Gemini (Google AI)
\`\`\`typescript
import { GoogleGenerativeAI } from '@google/generative-ai'
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

const result = await model.generateContent({
  contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
})
\`\`\`

### Anthropic Claude
\`\`\`typescript
import Anthropic from '@anthropic-ai/sdk'
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const response = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  system: 'You are helpful.',
  messages: [{ role: 'user', content: 'Hello' }],
})
\`\`\`

## Streaming
\`\`\`typescript
// Always use streaming for chat UX
const stream = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [...],
  stream: true,
})
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '')
}
\`\`\`

## Structured Output
\`\`\`typescript
import { z } from 'zod'
const ResponseSchema = z.object({
  answer: z.string(),
  confidence: z.number().min(0).max(1),
  sources: z.array(z.string()).optional(),
})

// OpenAI: response_format with json_schema
// Anthropic: tool use with structured tool definition
// Gemini: response_mime_type with response_schema
\`\`\`

## Frameworks & Abstractions

| Tool | Best For | Key Feature |
|---|---|---|
| Vercel AI SDK | Full-stack apps | Streaming, tool use, multi-provider |
| LangChain | Complex chains | Agents, RAG, tools, memory |
| LlamaIndex | RAG applications | Document ingestion, query engines |
| DSPy | Prompt optimization | Compilation-based prompt tuning |

## Error Handling & Retries
- Implement exponential backoff with jitter
- Handle: rate limits (429), timeouts, server errors (5xx), token limit errors
- Set per-client timeouts: 30s for chat, 60s for long generation
- Log all API errors: model, prompt length, error type, latency

## Cost Optimization
- Use smaller/faster models for simple tasks (classification, extraction)
- Cache identical requests (semantic caching with embedding similarity)
- Batch requests where possible (OpenAI supports batch API at 50% cost)
- Truncate conversation history to fit context window
- Monitor token usage per user/session

## Security Considerations
- Never expose API keys in client-side code
- Implement prompt injection defenses (input validation, separator tokens)
- Rate-limit per user to prevent abuse
- Sanitize model output before rendering (XSS prevention)
- Log and audit all AI API calls for compliance
- Use content moderation endpoints for user-facing apps

## Rules
- Always set timeouts on AI API calls (network requests can hang indefinitely)
- Use structured output (JSON schema / tool use) for programmatic consumption
- Implement retries with exponential backoff for transient failures
- Cache identical or semantically similar requests to reduce cost and latency
- Log token usage per request for cost tracking and optimization
- Never hardcode API keys — always use environment variables or secrets manager
- Handle token limit errors by truncating or summarizing context`

export function registerAiProviderSkill(): void {
  registerBundledSkill({
    name: 'ai-provider',
    description:
      'Integrate with AI model APIs (OpenAI, Gemini, Anthropic), LLM frameworks, streaming, structured output, and cost optimization.',
    whenToUse:
      'Use when integrating AI model APIs, building LLM features (chat, RAG, agents), setting up streaming, implementing structured output, or optimizing AI API costs. Use for Vercel AI SDK, LangChain, or custom AI integration.',
    aliases: ['ai', 'llm', 'openai', 'gemini', 'anthropic', 'langchain'],
    userInvocable: true,
    async getPromptForCommand(args) {
      const parts = [AI_PROVIDER_SKILL_PROMPT]
      if (args) {
        parts.push(`## User Request\n\n${args}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
