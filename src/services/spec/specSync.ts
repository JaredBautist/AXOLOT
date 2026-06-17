import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { registerPostSamplingHook, type REPLHookContext } from '../../utils/hooks/postSamplingHooks.js'
import { logForDebugging } from '../../utils/debug.js'
import { getCwd } from '../../utils/cwd.js'

export interface SpecTask {
  id: string
  description: string
  status: 'pending' | 'in-progress' | 'done' | 'cancelled'
  priority?: string
  area?: string
}

export interface SpecRequirement {
  id: string
  description: string
  type: 'functional' | 'non-functional'
  status: 'pending' | 'in-progress' | 'done'
  priority?: string
}

export interface SpecDesignDecision {
  id: string
  description: string
}

export interface SpecContent {
  requirements: SpecRequirement[]
  tasks: SpecTask[]
  designDecisions: SpecDesignDecision[]
}

const SPEC_TASK_RE = /-\s*\[([ x-])\]\s*(TSK-\d+):\s*(.+?)(?:\s*\(([^)]*)\))?$/gm
const REQ_RE = /-\s*(REQ-\d+|NF-\d+):\s*(.+?)\s*-\s*Status:\s*(.+)/gm
const ADR_RE = /-\s*(ADR-\d+):\s*(.+)/gm

function findUp(filename: string, startDir: string): string | null {
  let dir = resolve(startDir)
  for (let i = 0; i < 20; i++) {
    const candidate = join(dir, filename)
    if (existsSync(candidate)) return candidate
    const parent = resolve(dir, '..')
    if (parent === dir) return null
    dir = parent
  }
  return null
}

function ensureAxolotDir(cwd: string): string {
  const axolotDir = join(cwd, '.axolot')
  if (!existsSync(axolotDir)) {
    mkdirSync(axolotDir, { recursive: true })
  }
  const memoryDir = join(axolotDir, 'memory')
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true })
  }
  return axolotDir
}

export function readSpec(cwd?: string): SpecContent | null {
  const cwdActual = cwd ?? getCwd?.() ?? process.cwd()
  const specPath = findUp('SPEC.md', join(cwdActual, '.axolot')) ?? findUp('SPEC.md', cwdActual)
  if (!specPath) return null

  try {
    const content = readFileSync(specPath, 'utf-8')
    return parseSpec(content)
  } catch {
    return null
  }
}

export function parseSpec(content: string): SpecContent {
  const spec: SpecContent = { requirements: [], tasks: [], designDecisions: [] }

  let match: RegExpExecArray | null

  SPEC_TASK_RE.lastIndex = 0
  while ((match = SPEC_TASK_RE.exec(content)) !== null) {
    const statusChar = match[1]
    const status: SpecTask['status'] =
      statusChar === 'x' ? 'done' :
      statusChar === '-' ? 'cancelled' : 'pending'
    spec.tasks.push({
      id: match[2],
      description: match[3].trim(),
      status,
      area: match[4]?.trim() || undefined,
    })
  }

  REQ_RE.lastIndex = 0
  while ((match = REQ_RE.exec(content)) !== null) {
    const id = match[1].trim()
    const type: 'functional' | 'non-functional' = id.startsWith('NF-') ? 'non-functional' : 'functional'
    spec.requirements.push({
      id,
      description: match[2].trim(),
      type,
      status: match[3].trim().toLowerCase() as SpecRequirement['status'],
    })
  }

  ADR_RE.lastIndex = 0
  while ((match = ADR_RE.exec(content)) !== null) {
    spec.designDecisions.push({
      id: match[1].trim(),
      description: match[2].trim(),
    })
  }

  return spec
}

export function getSpecSummary(spec: SpecContent): string {
  const totalTasks = spec.tasks.length
  const doneTasks = spec.tasks.filter(t => t.status === 'done').length
  const pendingTasks = spec.tasks.filter(t => t.status === 'pending').length
  const inProgressTasks = spec.tasks.filter(t => t.status === 'in-progress').length

  const parts: string[] = []
  if (totalTasks > 0) {
    parts.push(`Tasks: ${doneTasks}/${totalTasks} done (${pendingTasks} pending, ${inProgressTasks} in-progress)`)
  }
  if (spec.requirements.length > 0) {
    const doneReqs = spec.requirements.filter(r => r.status === 'done').length
    parts.push(`Requirements: ${doneReqs}/${spec.requirements.length} met`)
  }
  if (spec.designDecisions.length > 0) {
    parts.push(`Design decisions: ${spec.designDecisions.length} documented`)
  }
  return parts.length > 0 ? parts.join(' · ') : ''
}

export function extractEditedFiles(context: REPLHookContext): string[] {
  const files: string[] = []
  for (const msg of context.messages) {
    const m = msg as any
    if (m.type === 'assistant' && m.message?.content) {
      const content = Array.isArray(m.message.content) ? m.message.content : []
      for (const block of content) {
        if (block.type === 'tool_use' && block.input) {
          const input = block.input as Record<string, unknown>
          const toolName = (block.name || '').toLowerCase()
          if (toolName === 'write' || toolName === 'edit') {
            const filePath = (input.file_path as string) || (input.filePath as string) || ''
            if (filePath && !files.includes(filePath)) {
              files.push(filePath)
            }
          }
        }
      }
    }
  }
  return files
}

export function logSessionSummary(context: REPLHookContext): void {
  const cwd = getCwd?.() ?? process.cwd()
  ensureAxolotDir(cwd)

  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10)
  const timeStr = now.toISOString().slice(11, 19)
  const memoryFile = join(cwd, '.axolot', 'memory', `${dateStr}.md`)

  const editedFiles = extractEditedFiles(context)
  if (editedFiles.length === 0) return

  const summary = [
    `## Session Log — ${timeStr}`,
    '',
    '### Files modified',
    ...editedFiles.map(f => `- \`${f}\``),
    '',
    '---',
    '',
  ].join('\n')

  try {
    appendFileSync(memoryFile, summary, 'utf-8')
    logForDebugging(`[SpecSync] Appended session log to ${memoryFile}`)
  } catch (err) {
    logForDebugging(`[SpecSync] Failed to write session log: ${err}`)
  }
}

export function validateSpecAgainstCode(spec: SpecContent, editedFiles: string[]): string[] {
  const warnings: string[] = []
  const pendingTasks = spec.tasks.filter(t => t.status === 'pending')

  for (const task of pendingTasks) {
    const desc = task.description.toLowerCase()
    const matchingFiles = editedFiles.filter(f => {
      const file = f.toLowerCase()
      return desc.split(/\s+/).some(word =>
        word.length > 4 && file.includes(word)
      )
    })
    if (matchingFiles.length > 0) {
      warnings.push(
        `You edited files related to "${task.description}" (${matchingFiles.join(', ')}) ` +
        `but ${task.id} is still marked as 'pending'. Consider marking it 'in-progress' or 'done' in SPEC.md.`
      )
    }
  }

  return warnings
}

export async function specPostTurnHook(context: REPLHookContext): Promise<void> {
  const editedFiles = extractEditedFiles(context)
  if (editedFiles.length === 0) return

  logSessionSummary(context)

  const spec = readSpec()
  if (!spec) return

  const warnings = validateSpecAgainstCode(spec, editedFiles)
  if (warnings.length > 0) {
    for (const w of warnings) {
      logForDebugging(`[SpecSync] ${w}`)
    }
  }
}

export function initSpecSync(): void {
  registerPostSamplingHook(specPostTurnHook)
}
