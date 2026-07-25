import type { TaskType } from '../orchestration/modelRegistry.js'
import { classifyTaskType } from '../orchestration/taskRouter.js'
import type { Message } from '../../types/message.js'

export type NativePromptProvider = 'openai' | 'gemini' | 'deepseek' | 'minimax' | 'glm' | 'kimi' | 'nvidia'

export function inferNativePromptTask(messages: Message[]): TaskType {
  const lastUserText = getLastUserText(messages)
  return classifyTaskType(lastUserText)
}

export function buildNativeTaskPromptModule(taskType: TaskType): string {
  const shared = [
    `## Task Focus: ${taskType}`,
    `Match your workflow to this task type. Do not use a generic answer shape when a specialized one fits better.`,
  ]

  const taskRules: Partial<Record<TaskType, string[]>> = {
    debugging: [
      'Form one concrete hypothesis, gather evidence with tools, then fix the root cause.',
      'Report the real failing output and the real verification output. Do not claim a fix without running a relevant check.',
    ],
    implementation: [
      'Read nearby patterns first, implement the smallest complete production change, then verify it.',
      'Avoid speculative abstractions, compatibility shims, or unrelated cleanup.',
    ],
    frontend: [
      'Before frontend code, apply the frontend skill standards: semantic HTML, accessible focus states, responsive layout, complete loading/empty/error states.',
      'Do not touch visual branding or TUI artwork unless the user explicitly asked for that exact visual change.',
    ],
    testing: [
      'Prefer tests that exercise real behavior over mocks. Run the narrowest meaningful test first, then broaden if needed.',
      'If no test harness exists, explain the closest verification you actually performed.',
    ],
    refactoring: [
      'Preserve behavior. Make incremental edits, keep names clear, and verify after each meaningful boundary.',
      'Do not refactor unrelated code just because you noticed it.',
    ],
    code_review: [
      'Prioritize correctness, security, regressions, and maintainability. Cite exact files and lines.',
      'Separate observed facts from inferred risks. Do not invent code you did not read.',
    ],
    security_review: [
      'Focus on exploitability, trust boundaries, secrets, injection, authz/authn, and unsafe shell/file handling.',
      'For dual-use topics, stay defensive and refuse destructive or evasive instructions.',
    ],
    architecture: [
      'Give one recommended design, its trade-offs, and the migration path. Avoid indecisive option lists.',
      'Anchor recommendations in current code and constraints, not generic architecture advice.',
    ],
    research: [
      'Explore first, summarize only verified findings, and cite files/functions precisely.',
      'Do not modify files unless the user pivots from research to implementation.',
    ],
    documentation: [
      'Document what is true in the current code. Do not create new docs unless explicitly requested.',
      'Prefer concise usage-oriented docs over broad marketing copy.',
    ],
    backend: [
      'Trace request/data flow end-to-end before changing behavior. Validate at system boundaries only.',
      'Consider API contracts, error semantics, auth, and persistence effects.',
    ],
    devops: [
      'Treat deployment, CI, and infra changes as shared-state changes. Ask before risky actions like pushing or altering pipelines.',
      'Prefer reproducible commands and report exact command output.',
    ],
    data_analysis: [
      'State assumptions, inspect data shape before analysis, and avoid conclusions unsupported by the data.',
      'Show compact results and methodology when it affects interpretation.',
    ],
    quick_answer: [
      'Answer directly and briefly. Use tools only if the answer depends on current repo state or recent external facts.',
    ],
    planning: [
      'Turn ambiguity into a concrete execution plan. Identify the first safe implementation slice.',
    ],
  }

  return [...shared, ...(taskRules[taskType] ?? taskRules.planning ?? [])]
    .map(line => `- ${line}`)
    .join('\n')
}

export function buildNativeProviderPromptModule(provider: NativePromptProvider): string {
  const modules: Record<NativePromptProvider, string[]> = {
    openai: [
      'Use structured, concise responses and deterministic tool calls.',
      'When emitting function/tool schemas or structured JSON, prefer strict schemas where the tool layer supports them.',
    ],
    deepseek: [
      'Use explicit internal step-by-step reasoning before acting, but keep user-facing output concise.',
      'Parallelize independent tool calls aggressively and prefer concrete evidence over broad narration.',
    ],
    gemini: [
      'Keep tool intent and output format explicit. Gemini works best with flat, unambiguous instructions.',
      'Avoid deeply nested reasoning in user-facing text; present the result cleanly.',
    ],
    minimax: [
      'Use the long context carefully: preserve tool-call/tool-result pairing and avoid noisy recaps.',
      'Be concise and structured; prefer clean state summaries over verbose transcripts.',
    ],
    glm: [
      'Follow tool schemas exactly and keep tool arguments minimal and valid JSON.',
      'Reason step-by-step internally, but keep user-facing output concise and evidence-backed.',
    ],
    kimi: [
      'Leverage the long context without noisy recaps; preserve tool-call/tool-result pairing.',
      'Prefer decisive, structured answers over verbose exploration.',
    ],
    nvidia: [
      'This model is served over an OpenAI-compatible endpoint; follow tool schemas strictly and emit valid JSON tool arguments.',
      'Keep reasoning internal and user-facing output concise and evidence-backed.',
    ],
  }

  return ['## Provider Tuning', ...modules[provider].map(line => `- ${line}`)].join('\n')
}

export function shouldIncludeNativeFrontendPrompt(taskType: TaskType, messages: Message[]): boolean {
  if (taskType === 'frontend') return true
  const text = getLastUserText(messages).toLowerCase()
  return /\b(ui|ux|frontend|front-end|react|vue|svelte|angular|next\.?js|component|css|scss|html|tailwind|style|styling|layout|responsive|design|redesign|theme|dashboard|landing|website|web ?page|page|hero|navbar|modal|button|form|card|animation|animate|transition|svg|figma|tui|logo|branding)\b/.test(text)
}

export function buildNativeFrontendPromptModule(): string {
  return [
    '## Frontend Design Bar — Distinctive, Production-Grade UI',
    'Treat every interface as a design opportunity. Generic, templated "AI slop" output is a failure. Aim for the quality bar of a senior product designer who commits fully to a vision.',
    '',
    '### Decide before you code',
    '- Commit to ONE bold aesthetic direction (e.g. refined-minimal, editorial/magazine, brutalist, retro-futuristic, organic, luxury, playful). Intentionality beats intensity.',
    '- Name the single memorable detail that makes this interface unforgettable, then build toward it.',
    '',
    '### Execution standards',
    '- Typography: choose characterful, high-quality fonts and a real type scale. NEVER default to Inter/Roboto/Arial/system stacks or reflexively reach for Space Grotesk. Pair a distinctive display font with a clean body font.',
    '- Color & theme: commit to a cohesive palette via CSS variables. A dominant color with sharp accents beats a timid, evenly-spread palette. Avoid the purple-gradient-on-white cliché.',
    '- Layout & space: deliberate visual hierarchy; generous negative space or controlled density; unexpected composition (asymmetry, overlap, grid-breaking) when it serves the concept — not decoration for its own sake.',
    '- Motion: one well-orchestrated page load with staggered reveals, plus purposeful hover/focus micro-interactions. CSS-first for plain HTML; the Motion library for React when available. Always honor prefers-reduced-motion.',
    '- Depth & atmosphere: avoid flat solid fills — layer gradient meshes, subtle noise/grain, soft shadows, textures, or patterns that match the chosen aesthetic.',
    '',
    '### Non-negotiables',
    '- Semantic, accessible HTML: real labels, visible focus states, sufficient contrast, full keyboard support.',
    '- Handle every state: loading, empty, error, hover, focus, disabled.',
    '- Responsive from small mobile to large desktop — no fixed-width desktop-only layouts.',
    '- Ship production-grade working code: real content, wired-up interactions, no dead buttons or lorem-only stubs.',
    '- Match code complexity to the vision: maximalist needs rich effects; minimalist needs restraint and pixel-level precision.',
    '- If a frontend skill fits (/frontend-design, /codex-frontend-master, /v0-frontend), apply its full guidance before writing code.',
    '',
    '### Axolot repo guard',
    '- Do NOT change this repo’s own TUI branding, logos, mascot (the pink axolotl), ASCII art, or visual layout unless the user explicitly authorized that exact visual change.',
  ].join('\n')
}

export function buildNativeSkillPromptModule(taskType: TaskType): string {
  const skillByTask: Partial<Record<TaskType, string>> = {
    frontend: '/codex-frontend-master or /frontend-design',
    testing: '/test',
    code_review: '/review',
    refactoring: '/refactor',
    architecture: '/architecture',
    security_review: '/backend-security',
    backend: '/api-design or /backend-security when relevant',
    devops: '/deploy',
    documentation: '/docs',
  }
  const skill = skillByTask[taskType]
  return [
    '## Skill Routing',
    '- If the user request matches a skill, invoke that skill before implementation.',
    skill ? `- For this task, the likely skill is ${skill}.` : '- Use /spec, /debug, /token-saver, or other skills only when they materially improve the task.',
    '- Do not bloat the answer by listing every available skill.',
  ].join('\n')
}

export function buildNativeSelfReviewModule(taskType: TaskType): string {
  const verifyLine = taskType === 'quick_answer'
    ? 'If no tool use was needed, answer directly and do not imply verification you did not run.'
    : 'Before final response, verify edits with a read-back and the narrowest relevant test/typecheck/build command available.'

  return [
    '## Silent Self-Review Before Responding',
    '- Did I use real repo/tool evidence for every concrete claim?',
    '- Did I avoid touching unrelated code and visual branding?',
    '- Did I report actual command output when claiming verification?',
    `- ${verifyLine}`,
  ].join('\n')
}

function getLastUserText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as any
    if (message?.message?.role !== 'user') continue
    return contentToText(message.message.content)
  }
  return ''
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      if (block && typeof block === 'object' && (block as any).type === 'text') {
        return String((block as any).text || '')
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}
