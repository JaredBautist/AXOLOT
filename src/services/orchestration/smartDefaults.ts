import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getRegistry, findBestModelForTask, type ModelEntry, type TaskType } from './modelRegistry.js'
import { logForDebugging } from '../../utils/debug.js'

export type BudgetMode = 'cost' | 'speed' | 'balanced' | 'quality'

export interface SmartDefaultOptions {
  budgetMode?: BudgetMode
  excludeProviders?: string[]
  apiKeys?: Record<string, string>
}

export interface SmartDefaultResult {
  model: ModelEntry
  provider: string
  budgetMode: BudgetMode
  confidence: 'high' | 'medium' | 'low'
  reason: string
  contextNeeded: number
}

export interface ProjectProfile {
  language: 'typescript' | 'javascript' | 'python' | 'rust' | 'go' | 'unknown'
  fileCount: number
  hasTypes: boolean
  hasFrontend: boolean
  hasBackend: boolean
  projectSize: 'small' | 'medium' | 'large'
}

/**
 * Resolve budget mode from env var or explicit option.
 */
export function resolveBudgetMode(mode?: string): BudgetMode {
  const raw = (mode ?? process.env.AXOLOT_BUDGET_MODE ?? 'balanced').toLowerCase()
  if (raw === 'cost' || raw === 'speed' || raw === 'balanced' || raw === 'quality') return raw
  return 'balanced'
}

/**
 * Detect which native providers have API keys configured.
 */
export function detectAvailableProviders(): Record<string, string> {
  const providers: Record<string, string> = {}

  if (process.env.OPENAI_API_KEY) providers['openai'] = process.env.OPENAI_API_KEY
  if (process.env.DEEPSEEK_API_KEY) providers['deepseek'] = process.env.DEEPSEEK_API_KEY
  if (process.env.GEMINI_API_KEY) providers['gemini'] = process.env.GEMINI_API_KEY
  if (process.env.MINIMAX_API_KEY) providers['minimax'] = process.env.MINIMAX_API_KEY
  if (process.env.ANTHROPIC_API_KEY) providers['anthropic'] = process.env.ANTHROPIC_API_KEY

  return providers
}

/**
 * Profile the current project to estimate context needs and task types.
 */
export function profileProject(cwd?: string): ProjectProfile {
  const dir = cwd ?? process.cwd()
  const files: string[] = []
  let hasTypes = false
  let hasFrontend = false
  let hasBackend = false

  // Collect file extensions up to a limit
  try {
    const walkDir = (path: string, depth: number) => {
      if (depth > 3) return
      try {
        const entries = readdirFast(path)
        for (const entry of entries) {
          if (entry.startsWith('.') || entry === 'node_modules' || entry === 'target') continue
          const fullPath = join(path, entry)
          try {
            const stat = statSyncFast(fullPath)
            if (stat.isDirectory()) {
              walkDir(fullPath, depth + 1)
            } else {
              files.push(entry)
              if (entry.endsWith('.ts') || entry.endsWith('.tsx')) hasTypes = true
              if (entry.endsWith('.tsx') || entry.endsWith('.jsx') || entry.endsWith('.vue') || entry.endsWith('.svelte') || entry.endsWith('.css') || entry.endsWith('.html')) hasFrontend = true
              if (entry.endsWith('.py') || entry.endsWith('.go') || entry.endsWith('.rs') || entry.endsWith('.java') || entry.endsWith('.rb') || entry.endsWith('.php')) hasBackend = true
            }
          } catch { /* skip unreadable */ }
        }
      } catch { /* skip unreadable dirs */ }
    }
    walkDir(dir, 0)
  } catch { /* fallback */ }

  // Detect language
  let language: ProjectProfile['language'] = 'unknown'
  for (const f of files) {
    const ext = f.split('.').pop()?.toLowerCase()
    if (ext === 'ts' || ext === 'tsx') { language = 'typescript'; break }
    if (ext === 'js' || ext === 'jsx') { language = 'javascript'; break }
    if (ext === 'py') { language = 'python'; break }
    if (ext === 'rs') { language = 'rust'; break }
    if (ext === 'go') { language = 'go'; break }
  }

  // Fallback to config files
  if (language === 'unknown') {
    if (existsSync(join(dir, 'package.json'))) language = 'javascript'
    else if (existsSync(join(dir, 'pyproject.toml')) || existsSync(join(dir, 'requirements.txt'))) language = 'python'
    else if (existsSync(join(dir, 'Cargo.toml'))) language = 'rust'
    else if (existsSync(join(dir, 'go.mod'))) language = 'go'
  }

  const fileCount = files.length
  const projectSize: 'small' | 'medium' | 'large' =
    fileCount < 30 ? 'small' :
    fileCount < 100 ? 'medium' : 'large'

  return { language, fileCount, hasTypes, hasFrontend, hasBackend, projectSize }
}

/**
 * Map project profile to likely task types.
 */
export function inferTaskTypes(profile: ProjectProfile): TaskType[] {
  const tasks: TaskType[] = []

  if (profile.hasFrontend && profile.hasBackend) tasks.push('implementation')
  else if (profile.hasFrontend) tasks.push('frontend')
  else if (profile.hasBackend) tasks.push('backend')
  else tasks.push('implementation')

  if (profile.hasTypes) tasks.push('code_review')
  if (profile.projectSize === 'large') tasks.push('refactoring')
  if (profile.language !== 'unknown') tasks.push('debugging')

  tasks.push('research')
  tasks.push('documentation')

  return tasks
}

/**
 * Get context window needed based on project size.
 */
export function estimateContextNeeded(profile: ProjectProfile): number {
  if (profile.projectSize === 'large') return 200_000
  if (profile.projectSize === 'medium') return 128_000
  return 64_000
}

/**
 * Get scoring weights based on budget mode.
 */
export function getWeightsForBudget(mode: BudgetMode): {
  reasoning: number
  coding: number
  toolUse: number
  costEfficiency: number
  speed: number
} {
  switch (mode) {
    case 'cost':
      return { reasoning: 1, coding: 1, toolUse: 1, costEfficiency: 3, speed: 1.5 }
    case 'speed':
      return { reasoning: 0.5, coding: 0.5, toolUse: 1, costEfficiency: 1, speed: 3 }
    case 'quality':
      return { reasoning: 3, coding: 3, toolUse: 2, costEfficiency: 0.2, speed: 0.2 }
    case 'balanced':
    default:
      return { reasoning: 1, coding: 1.5, toolUse: 1, costEfficiency: 0.5, speed: 0.5 }
  }
}

/**
 * Score a model entry with custom weights.
 */
export function scoreModel(entry: ModelEntry, weights: ReturnType<typeof getWeightsForBudget>): number {
  return (
    entry.capabilities.reasoning * weights.reasoning +
    entry.capabilities.coding * weights.coding +
    entry.capabilities.toolUse * weights.toolUse +
    entry.capabilities.costEfficiency * weights.costEfficiency +
    entry.capabilities.speed * weights.speed
  )
}

/**
 * Select the best model from the registry given available providers
 * and the budget mode, considering context requirements.
 */
export function selectSmartModel(
  task: TaskType,
  options: SmartDefaultOptions = {},
): SmartDefaultResult {
  const budgetMode = resolveBudgetMode(options.budgetMode as string | undefined)
  const availableProviders = options.apiKeys ?? detectAvailableProviders()
  const excludeProviders = options.excludeProviders ?? []

  // Step 1: Try exact task match with available providers
  let candidates = getRegistry().filter(m => {
    if (excludeProviders.includes(m.provider)) return false
    if (Object.keys(availableProviders).length > 0 && !availableProviders[m.provider]) return false
    return m.bestFor.includes(task)
  })

  // Step 2: Fallback to not-avoided
  if (candidates.length === 0) {
    candidates = getRegistry().filter(m => {
      if (excludeProviders.includes(m.provider)) return false
      if (Object.keys(availableProviders).length > 0 && !availableProviders[m.provider]) return false
      return !m.avoidFor.includes(task)
    })
  }

  // Step 3: If no API keys at all (none detected), return all candidates
  if (candidates.length === 0) {
    candidates = getRegistry().filter(m => {
      if (excludeProviders.includes(m.provider)) return false
      return !m.avoidFor.includes(task)
    })
  }

  if (candidates.length === 0) {
    const fallback = getRegistry()[0]
    return {
      model: fallback,
      provider: fallback.provider,
      budgetMode,
      confidence: 'low',
      reason: 'No specific match found; using first available model',
      contextNeeded: 64_000,
    }
  }

  const weights = getWeightsForBudget(budgetMode)

  candidates.sort((a, b) => scoreModel(b, weights) - scoreModel(a, weights))

  const best = candidates[0]
  const confidence = best.bestFor.includes(task) ? 'high' : 'medium'

  const reasonParts: string[] = []
  if (budgetMode !== 'balanced') reasonParts.push(`budget mode: ${budgetMode}`)
  if (best.bestFor.includes(task)) reasonParts.push(`best-for task: ${task}`)
  reasonParts.push(`score: ${scoreModel(best, weights).toFixed(1)}`)

  return {
    model: best,
    provider: best.provider,
    budgetMode,
    confidence,
    reason: reasonParts.join(', '),
    contextNeeded: best.capabilities.contextWindow,
  }
}

/**
 * Generate a system prompt fragment suggesting the recommended model
 * based on project profile and budget mode.
 */
export function getSmartDefaultPrompt(): string {
  const budgetMode = resolveBudgetMode()
  const available = detectAvailableProviders()
  const profile = profileProject()

  const availableList = Object.keys(available)
  if (availableList.length === 0) return ''

  const tasks = inferTaskTypes(profile)
  const recommendations = tasks.map(t => {
    const result = selectSmartModel(t, { budgetMode })
    return `  - **${t}**: ${result.model.name} (${result.provider}) — ${result.reason}`
  })

  return [
    `## Smart Defaults (${budgetMode} mode)`,
    '',
    `Available providers: ${availableList.join(', ')}`,
    `Project: ${profile.language} (${profile.projectSize}, ${profile.fileCount} files)`,
    '',
    'Recommended model per task type:',
    ...recommendations,
  ].join('\n')
}

function readdirFast(path: string): string[] {
  const fs = require('node:fs') as typeof import('node:fs')
  try {
    return fs.readdirSync(path)
  } catch {
    return []
  }
}

function statSyncFast(path: string) {
  const fs = require('node:fs') as typeof import('node:fs')
  return fs.statSync(path)
}
