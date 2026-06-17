import { registerBundledSkill } from '../bundledSkills.js'
import { getRegistry, formatModelEntry, type ModelEntry } from '../../services/orchestration/modelRegistry.js'
import { routeTask, classifyTaskType, getRoutingInstructions } from '../../services/orchestration/taskRouter.js'

function buildModelRecommendations(): string {
  const models = getRegistry()
  const byProvider = new Map<string, ModelEntry[]>()
  for (const m of models) {
    const p = byProvider.get(m.provider) || []
    p.push(m)
    byProvider.set(m.provider, p)
  }

  const lines: string[] = ['### Available Models']
  for (const [provider, entries] of byProvider) {
    lines.push(`\n**${provider}**:`)
    for (const e of entries) {
      lines.push(`  - ${formatModelEntry(e)}`)
      lines.push(`    Best for: ${e.bestFor.join(', ')}`)
    }
  }
  return lines.join('\n')
}

const DELEGATE_SKILL_PROMPT = `# Delegate Skill — Multi-Model Orchestration

Delegates tasks to specialized AI models based on their strengths.
Use this when a task would benefit from a different model than the one currently active.

${getRoutingInstructions()}

## Usage

### Explicit delegation
\`/delegate research the codebase for auth patterns using deepseek\`
\`/delegate review this PR using claude\`
\`/delegate write tests for the API using deepseek\`

### Auto-routing (let the system decide)
\`/delegate implement the user authentication module\`
\`/delegate investigate why the database queries are slow\`

### List available models
\`/delegate list-models\`

${buildModelRecommendations()}

## How to Delegate

When delegating a task to another model:

1. **Classify the task** — what type of work is this? (research, implementation, review, testing, etc.)
2. **Select the best model** — use the model registry to pick the right one
3. **Write a self-contained prompt** — the target model CANNOT see your conversation. Include:
   - The file paths and existing code context
   - Exactly what needs to be done
   - Any constraints or preferences
   - What "done" looks like
4. **Use the AgentTool** — spawn the target model via AgentTool with subagent_type "worker"
5. **Synthesize results** — when the worker returns, read and summarize for the user

## Routing Guide

| Task Type | Recommended Model | Why |
|-----------|-------------------|-----|
| Research | DeepSeek V4 Flash | Fast, cheap, 1M context |
| Architecture | Claude Sonnet 4.6 | Best reasoning + tool use |
| Code Review | Claude Sonnet 4.6 | Best code analysis |
| Implementation | Claude Sonnet 4.6 or GPT-4o | Strong coding + tools |
| Testing | DeepSeek or GPT-4o-mini | Fast, cheap |
| Debugging | Claude Sonnet 4.6 or o3-mini | Deep reasoning |
| Quick Answer | Haiku or GPT-4o-mini | Fastest, cheapest |
| Security Review | Claude Opus 4.6 or o3-mini | Deep analysis |
| Frontend | GPT-4o or Claude Sonnet | Strong design implementation |

## Rules

- Workers CANNOT see your conversation. Write self-contained prompts.
- Use SendMessage to continue a worker that has useful context.
- Always read the worker's results before reporting to the user.
- Do not delegate trivial tasks (simple questions, file reads).
- Do not delegate tasks the current model can handle efficiently.`

export function registerDelegateSkill(): void {
  registerBundledSkill({
    name: 'delegate',
    description:
      'Multi-model orchestration: delegate tasks to specialized AI models based on their strengths (research, code review, testing, architecture, etc.).',
    whenToUse:
      'Use when you want to route a task to a model that is better suited for it. Use for research (DeepSeek), architecture (Claude Sonnet), code review (Claude Sonnet), testing (DeepSeek/GPT-4o-mini), or any task where model specialization helps.',
    aliases: ['route', 'orchestrate', 'multi-model', 'assign', 'dm'],
    userInvocable: true,
    async getPromptForCommand(args) {
      const parts = [DELEGATE_SKILL_PROMPT]
      if (args) {
        // If asking to list models, show registry
        if (args.toLowerCase().includes('list-models') || args.toLowerCase() === 'list') {
          parts.push(`\n## Current Model Registry\n\n${buildModelRecommendations()}`)
        } else {
          // Auto-classify and recommend
          const taskType = classifyTaskType(args)
          const routing = routeTask(args)
          parts.push(`\n## Routing Analysis\n\n**Request**: ${args}\n`)
          parts.push(`**Classified as**: ${routing.taskType}`)
          parts.push(`**Recommended model**: ${routing.recommendedModel} (${routing.provider})`)
          parts.push(`**Confidence**: ${routing.confidence}`)
          parts.push(`**Reasoning**: ${routing.reasoning}`)
          parts.push(`\n**To delegate, write a self-contained prompt for the target model and spawn it via AgentTool with subagent_type="worker".**`)
        }
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
