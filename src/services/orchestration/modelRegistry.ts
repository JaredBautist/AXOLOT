/**
 * Model Registry — defines capabilities and recommended use cases
 * for each supported model across all providers.
 *
 * Used by the task router to automatically select the best model
 * for a given task type, and by the /delegate skill for explicit
 * multi-model orchestration.
 */

export type ProviderId = 'anthropic' | 'openai' | 'deepseek' | 'gemini' | 'minimax' | 'ollama'

export interface ModelCapabilities {
  /** General reasoning ability (1-10) */
  reasoning: number
  /** Code generation quality (1-10) */
  coding: number
  /** Tool calling reliability (1-10) */
  toolUse: number
  /** Cost efficiency (1-10, higher = cheaper) */
  costEfficiency: number
  /** Speed (1-10, higher = faster) */
  speed: number
  /** Context window in tokens */
  contextWindow: number
  /** Knowledge cutoff date */
  cutoff: string
}

export interface ModelEntry {
  id: string
  provider: ProviderId
  name: string
  capabilities: ModelCapabilities
  /** Best suited task types */
  bestFor: TaskType[]
  /** Tasks this model should avoid */
  avoidFor: TaskType[]
}

export type TaskType =
  | 'research'
  | 'architecture'
  | 'implementation'
  | 'debugging'
  | 'code_review'
  | 'testing'
  | 'refactoring'
  | 'documentation'
  | 'frontend'
  | 'backend'
  | 'data_analysis'
  | 'devops'
  | 'security_review'
  | 'quick_answer'
  | 'planning'

const REGISTRY: ModelEntry[] = [
  // === Anthropic Claude ===
  {
    id: 'claude-sonnet-4-6',
    provider: 'anthropic',
    name: 'Claude Sonnet 4.6',
    capabilities: { reasoning: 10, coding: 10, toolUse: 9, costEfficiency: 5, speed: 7, contextWindow: 200_000, cutoff: 'August 2025' },
    bestFor: ['architecture', 'code_review', 'refactoring', 'implementation', 'debugging', 'planning'],
    avoidFor: ['quick_answer'],
  },
  {
    id: 'claude-opus-4-6',
    provider: 'anthropic',
    name: 'Claude Opus 4.6',
    capabilities: { reasoning: 10, coding: 10, toolUse: 10, costEfficiency: 3, speed: 4, contextWindow: 200_000, cutoff: 'May 2025' },
    bestFor: ['architecture', 'planning', 'security_review', 'code_review', 'debugging'],
    avoidFor: ['quick_answer', 'testing'],
  },
  {
    id: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    name: 'Claude Haiku 4.5',
    capabilities: { reasoning: 7, coding: 7, toolUse: 8, costEfficiency: 9, speed: 10, contextWindow: 200_000, cutoff: 'February 2025' },
    bestFor: ['quick_answer', 'research', 'testing', 'documentation'],
    avoidFor: ['architecture', 'security_review'],
  },

  // === OpenAI ===
  {
    id: 'gpt-4o',
    provider: 'openai',
    name: 'GPT-4o',
    capabilities: { reasoning: 9, coding: 8, toolUse: 8, costEfficiency: 6, speed: 8, contextWindow: 128_000, cutoff: 'October 2024' },
    bestFor: ['implementation', 'debugging', 'frontend', 'data_analysis'],
    avoidFor: ['architecture', 'security_review'],
  },
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    name: 'GPT-4o Mini',
    capabilities: { reasoning: 7, coding: 6, toolUse: 7, costEfficiency: 10, speed: 10, contextWindow: 128_000, cutoff: 'October 2024' },
    bestFor: ['quick_answer', 'research', 'testing', 'documentation'],
    avoidFor: ['architecture', 'implementation'],
  },
  {
    id: 'o3-mini',
    provider: 'openai',
    name: 'o3-mini',
    capabilities: { reasoning: 10, coding: 9, toolUse: 7, costEfficiency: 7, speed: 6, contextWindow: 200_000, cutoff: 'October 2024' },
    bestFor: ['architecture', 'debugging', 'planning', 'security_review'],
    avoidFor: ['quick_answer', 'frontend'],
  },

  // === DeepSeek ===
  {
    id: 'deepseek-chat',
    provider: 'deepseek',
    name: 'DeepSeek V4 Flash',
    capabilities: { reasoning: 9, coding: 8, toolUse: 7, costEfficiency: 9, speed: 9, contextWindow: 1_000_000, cutoff: 'May 2025' },
    bestFor: ['research', 'testing', 'documentation', 'quick_answer', 'data_analysis'],
    avoidFor: ['architecture', 'security_review'],
  },
  {
    id: 'deepseek-reasoner',
    provider: 'deepseek',
    name: 'DeepSeek Reasoner',
    capabilities: { reasoning: 9, coding: 8, toolUse: 6, costEfficiency: 8, speed: 5, contextWindow: 64_000, cutoff: 'March 2025' },
    bestFor: ['debugging', 'planning', 'data_analysis'],
    avoidFor: ['frontend', 'quick_answer'],
  },

  // === Google Gemini ===
  {
    id: 'gemini-2.5-pro',
    provider: 'gemini',
    name: 'Gemini 2.5 Pro',
    capabilities: { reasoning: 9, coding: 8, toolUse: 7, costEfficiency: 7, speed: 6, contextWindow: 1_000_000, cutoff: 'January 2025' },
    bestFor: ['research', 'data_analysis', 'documentation', 'planning'],
    avoidFor: ['frontend', 'quick_answer'],
  },
  {
    id: 'gemini-2.5-flash',
    provider: 'gemini',
    name: 'Gemini 2.5 Flash',
    capabilities: { reasoning: 7, coding: 6, toolUse: 6, costEfficiency: 10, speed: 10, contextWindow: 1_000_000, cutoff: 'January 2025' },
    bestFor: ['quick_answer', 'research', 'testing'],
    avoidFor: ['architecture', 'implementation'],
  },
]

export function getRegistry(): ModelEntry[] {
  return REGISTRY
}

export function findModel(modelId: string): ModelEntry | undefined {
  const normalId = modelId.toLowerCase().trim()
  return REGISTRY.find(m => m.id.toLowerCase().includes(normalId) || normalId.includes(m.id.toLowerCase()))
}

export function findModelsByProvider(provider: ProviderId): ModelEntry[] {
  return REGISTRY.filter(m => m.provider === provider)
}

export function findModelsByTask(task: TaskType): ModelEntry[] {
  return REGISTRY
    .filter(m => m.bestFor.includes(task))
    .sort((a, b) => {
      const aScore = a.capabilities.coding + a.capabilities.reasoning + a.capabilities.toolUse
      const bScore = b.capabilities.coding + b.capabilities.reasoning + b.capabilities.toolUse
      return bScore - aScore
    })
}

export function findBestModelForTask(
  task: TaskType,
  options?: {
    preferCost?: boolean
    preferSpeed?: boolean
    preferReasoning?: boolean
    excludeProviders?: ProviderId[]
  },
): ModelEntry | undefined {
  let candidates = REGISTRY.filter(m => m.bestFor.includes(task))

  if (options?.excludeProviders) {
    candidates = candidates.filter(m => !options.excludeProviders!.includes(m.provider))
  }

  if (candidates.length === 0) {
    candidates = [...REGISTRY].filter(m => !m.avoidFor.includes(task))
  }
  if (candidates.length === 0) return undefined

  candidates.sort((a, b) => {
    // Weight scoring based on preferences
    const weights = {
      reasoning: options?.preferReasoning ? 3 : 1,
      coding: 1.5,
      toolUse: 1,
      costEfficiency: options?.preferCost ? 3 : 0.5,
      speed: options?.preferSpeed ? 3 : 0.5,
    }
    const scoreA =
      a.capabilities.reasoning * weights.reasoning +
      a.capabilities.coding * weights.coding +
      a.capabilities.toolUse * weights.toolUse +
      a.capabilities.costEfficiency * weights.costEfficiency +
      a.capabilities.speed * weights.speed
    const scoreB =
      b.capabilities.reasoning * weights.reasoning +
      b.capabilities.coding * weights.coding +
      b.capabilities.toolUse * weights.toolUse +
      b.capabilities.costEfficiency * weights.costEfficiency +
      b.capabilities.speed * weights.speed
    return scoreB - scoreA
  })

  return candidates[0]
}

export function formatModelEntry(entry: ModelEntry): string {
  return `${entry.name} (${entry.provider}) — Reasoning: ${entry.capabilities.reasoning}/10, Coding: ${entry.capabilities.coding}/10, Tools: ${entry.capabilities.toolUse}/10, ${entry.capabilities.contextWindow.toLocaleString()} ctx`
}

export function suggestModelForTask(task: TaskType): string {
  const best = findBestModelForTask(task)
  if (!best) return 'No suitable model found'
  return formatModelEntry(best)
}
