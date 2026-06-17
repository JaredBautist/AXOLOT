/**
 * Task Router — matches user requests to the optimal model
 * based on task type, capability requirements, and constraints.
 *
 * This module sits between the user's request and the model selection.
 * It analyzes the request, determines the task type, and recommends
 * the best model from the registry.
 */

import {
  findBestModelForTask,
  type ProviderId,
  type TaskType,
} from './modelRegistry.js'

export interface RoutingDecision {
  taskType: TaskType
  recommendedModel: string
  provider: ProviderId
  confidence: 'high' | 'medium' | 'low'
  reasoning: string
}

/**
 * Classify a user request into a task type based on keywords and patterns.
 */
export function classifyTaskType(request: string): TaskType {
  const lower = request.toLowerCase()

  // Architecture / planning
  if (
    /\b(architect|design|plan|structure|system design|decision|tradeoff|how should I)\b/.test(lower)
  ) return 'architecture'

  // Research
  if (
    /\b(research|investigate|explore|find out|look into|how does|what is|understand|analyze this code|explain the code)\b/.test(lower) &&
    !/\b(implement|write|create|build|fix|change)\b/.test(lower)
  ) return 'research'

  // Code review
  if (
    /\b(review|code review|review this PR|check my code|quality|audit)\b/.test(lower)
  ) return 'code_review'

  // Security review
  if (
    /\b(security|vulnerability|OWASP|injection|XSS|SQLi|auth|permission|harden)\b/.test(lower)
  ) return 'security_review'

  // Debugging
  if (
    /\b(debug|bug|error|fix|crash|broken|not working|failing|issue|problem|wrong)\b/.test(lower)
  ) return 'debugging'

  // Testing
  if (
    /\b(test|spec|coverage|unit test|integration test|e2e|TDD|assert)\b/.test(lower)
  ) return 'testing'

  // Refactoring
  if (
    /\b(refactor|clean up|improve|simplify|extract|restructure|modernize)\b/.test(lower)
  ) return 'refactoring'

  // Frontend
  if (
    /\b(frontend|UI|component|React|Vue|Angular|CSS|HTML|style|layout|responsive|shadcn|tailwind|design system)\b/.test(lower)
  ) return 'frontend'

  // Backend
  if (
    /\b(backend|API|REST|GraphQL|endpoint|database|query|migration|schema|server|middleware|auth|oauth)\b/.test(lower)
  ) return 'backend'

  // Documentation
  if (
    /\b(document|README|docstring|changelog|comment|explain|write docs|documentation|tutorial|guide)\b/.test(lower)
  ) return 'documentation'

  // Data analysis
  if (
    /\b(analyze|data|statistics|chart|graph|metrics|trend|aggregate|report)\b/.test(lower)
  ) return 'data_analysis'

  // DevOps
  if (
    /\b(deploy|CI|CD|Docker|Kubernetes|infrastructure|pipeline|terraform|cloud|AWS|GCP|Azure)\b/.test(lower)
  ) return 'devops'

  // Quick answer
  if (
    /\b(what is|how do I|explain|meaning of|difference between|tell me about)\b/.test(lower) &&
    lower.split(/\s+/).length < 15
  ) return 'quick_answer'

  // Implementation (catch-all for "write code", "create", "implement", "build")
  if (
    /\b(implement|write|create|build|add|develop|make a|code up)\b/.test(lower)
  ) return 'implementation'

  return 'planning'
}

/**
 * Analyze a user request and return a routing decision with
 * recommended model, provider, and reasoning.
 */
export function routeTask(
  request: string,
  options?: {
    preferCost?: boolean
    preferSpeed?: boolean
    preferReasoning?: boolean
    currentModel?: string
    excludeProviders?: ProviderId[]
  },
): RoutingDecision {
  const taskType = classifyTaskType(request)

  const best = findBestModelForTask(taskType, {
    preferCost: options?.preferCost,
    preferSpeed: options?.preferSpeed,
    preferReasoning: options?.preferReasoning,
    excludeProviders: options?.excludeProviders,
  })

  if (!best) {
    return {
      taskType,
      recommendedModel: options?.currentModel || 'claude-sonnet-4-6',
      provider: 'anthropic',
      confidence: 'low',
      reasoning: `No specialized model found for "${taskType}". Falling back to default.`,
    }
  }

  // Build reasoning
  const reasoningParts: string[] = [
    `Task classified as "${taskType}"`,
    `${best.name} selected (reasoning: ${best.capabilities.reasoning}/10, coding: ${best.capabilities.coding}/10, cost: ${best.capabilities.costEfficiency}/10)`,
  ]

  if (options?.currentModel && best.id !== options.currentModel) {
    reasoningParts.push(`Switch recommended: current model is not optimal for ${taskType}`)
  }

  const confidence = best.bestFor.includes(taskType) ? 'high' : 'medium'

  return {
    taskType,
    recommendedModel: best.id,
    provider: best.provider,
    confidence,
    reasoning: reasoningParts.join('. '),
  }
}

/**
 * Build a system prompt fragment that tells the model about
 * multi-model routing capabilities.
 */
export function getRoutingInstructions(): string {
  return `## Multi-Model Orchestration

You can delegate tasks to specialized models using /delegate. This is useful when:

- **Research tasks**: delegate to DeepSeek (fast, cheap, large context)
- **Architecture decisions**: delegate to Claude Sonnet (best reasoning)
- **Code review**: delegate to Claude Sonnet (best code analysis)
- **Quick answers**: delegate to Haiku or GPT-4o-mini (fast, cheap)
- **Testing**: delegate to DeepSeek or GPT-4o-mini (fast execution)

To delegate: \`/delegate <task description> to <model/provider>\`
Or let the system auto-route: \`/delegate <task description>\` (uses smart routing)

When you delegate, write a self-contained prompt that includes all context
the target model needs. The target model cannot see your conversation history.`
}
