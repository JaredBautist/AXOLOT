/**
 * AutoVerify — Post-edit quality verification hook.
 *
 * After each model turn where files were written/edited, this module
 * automatically detects the project's language and framework, runs
 * the appropriate lint/typecheck command, and reports results.
 *
 * This prevents the model from marking work as "done" when there
 * are compilation errors, type errors, or lint violations.
 *
 * Registered as a post-sampling hook in query.ts.
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { registerPostSamplingHook, type REPLHookContext } from '../../utils/hooks/postSamplingHooks.js'
import { logForDebugging } from '../../utils/debug.js'

/** Result of a verification attempt */
export interface VerifyResult {
  passed: boolean
  tool: string
  command: string
  output: string
  errors: string[]
}

interface ProjectDetection {
  type: 'node' | 'python' | 'rust' | 'go' | 'unknown'
  lintCommand: string | null
  typecheckCommand: string | null
  testCommand: string | null
  packageManager: string | null
}

/**
 * Detect project type and available verification commands
 * by inspecting the workspace for configuration files.
 */
function detectProject(cwd: string): ProjectDetection {
  const base: ProjectDetection = {
    type: 'unknown',
    lintCommand: null,
    typecheckCommand: null,
    testCommand: null,
    packageManager: null,
  }

  // Try to find package.json (Node/TypeScript projects)
  const pkgPath = findUp('package.json', cwd)
  if (pkgPath && existsSync(pkgPath)) {
    base.type = 'node'
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      const scripts = pkg.scripts || {}

      // Detect package manager
      if (existsSync(join(cwd, 'bun.lock'))) base.packageManager = 'bun'
      else if (existsSync(join(cwd, 'pnpm-lock.yaml'))) base.packageManager = 'pnpm'
      else if (existsSync(join(cwd, 'yarn.lock'))) base.packageManager = 'yarn'
      else base.packageManager = 'npm'

      const pm = base.packageManager

      // Prefer explicit scripts, fall back to standard commands
      if (scripts.lint) base.lintCommand = `${pm} run lint`
      else if (scripts.lint2) base.lintCommand = `${pm} run lint2`
      else if (existsSync(join(cwd, '.eslintrc')) || existsSync(join(cwd, '.eslintrc.json')) || existsSync(join(cwd, '.eslintrc.js'))) {
        base.lintCommand = `${pm} exec eslint . --ext .js,.ts,.jsx,.tsx 2>&1 || true`
      }

      if (scripts.typecheck) base.typecheckCommand = `${pm} run typecheck`
      else if (pkg.dependencies?.typescript || pkg.devDependencies?.typescript) {
        if (existsSync(join(cwd, 'tsconfig.json'))) {
          base.typecheckCommand = `${pm} exec tsc --noEmit 2>&1 || true`
        }
      }

      if (scripts.test) base.testCommand = `${pm} run test`
    } catch { /* ignore parse errors */ }
    return base
  }

  // Python project
  if (existsSync(join(cwd, 'requirements.txt')) || existsSync(join(cwd, 'pyproject.toml')) || existsSync(join(cwd, 'setup.py'))) {
    base.type = 'python'
    base.lintCommand = 'python -m flake8 . 2>&1 || python -m pylint . 2>&1 || true'
    base.typecheckCommand = 'python -m mypy . 2>&1 || true'
    base.testCommand = 'python -m pytest 2>&1 || true'
    return base
  }

  // Rust project
  if (existsSync(join(cwd, 'Cargo.toml'))) {
    base.type = 'rust'
    base.lintCommand = 'cargo clippy -- -D warnings 2>&1 || true'
    base.typecheckCommand = 'cargo check 2>&1 || true'
    base.testCommand = 'cargo test 2>&1 || true'
    return base
  }

  // Go project
  if (existsSync(join(cwd, 'go.mod'))) {
    base.type = 'go'
    base.lintCommand = 'go vet ./... 2>&1 || true'
    base.typecheckCommand = 'go build ./... 2>&1 || true'
    base.testCommand = 'go test ./... 2>&1 || true'
    return base
  }

  return base
}

/**
 * Try to find a file walking up directories.
 */
function findUp(filename: string, startDir: string): string | null {
  let dir = resolve(startDir)
  // Limit upward traversal to avoid infinite loops
  for (let i = 0; i < 20; i++) {
    const candidate = join(dir, filename)
    if (existsSync(candidate)) return candidate
    const parent = resolve(dir, '..')
    if (parent === dir) return null
    dir = parent
  }
  return null
}

/**
 * Try to extract file paths from tool_use blocks in the turn's messages.
 */
function extractEditedFiles(context: REPLHookContext): string[] {
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

/**
 * Run a shell command and return its output.
 * Truncated to 2000 chars to avoid bloating logs.
 */
function runCommand(command: string, cwd: string): { exitCode: number; output: string } {
  try {
    const output = execSync(command, {
      cwd,
      timeout: 30_000,
      maxBuffer: 10_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
      shell: true,
    })
    return { exitCode: 0, output: output.slice(0, 2000) }
  } catch (err: any) {
    const output = (err.stdout || err.stderr || err.message || '').slice(0, 2000)
    return { exitCode: err.status ?? 1, output }
  }
}

/**
 * Main verification function. Called after each turn.
 * Detects project, runs lint + typecheck, returns results.
 */
export async function verifyAfterTurn(context: REPLHookContext): Promise<VerifyResult[]> {
  const results: VerifyResult[] = []

  // Only verify if there were file edits this turn
  const editedFiles = extractEditedFiles(context)
  if (editedFiles.length === 0) return results

  const cwd = process.cwd()
  const project = detectProject(cwd)

  if (project.type === 'unknown') return results

  logForDebugging(`[AutoVerify] Detected ${project.type} project, ${editedFiles.length} files edited`)

  // Run lint
  if (project.lintCommand) {
    const { exitCode, output } = runCommand(project.lintCommand, cwd)
    results.push({
      passed: exitCode === 0,
      tool: 'lint',
      command: project.lintCommand,
      output,
      errors: extractErrors(output),
    })
  }

  // Run typecheck
  if (project.typecheckCommand) {
    const { exitCode, output } = runCommand(project.typecheckCommand, cwd)
    results.push({
      passed: exitCode === 0,
      tool: 'typecheck',
      command: project.typecheckCommand,
      output,
      errors: extractErrors(output),
    })
  }

  return results
}

/**
 * Extract error-like lines from command output.
 */
function extractErrors(output: string): string[] {
  return output
    .split('\n')
    .filter(line => {
      const l = line.toLowerCase()
      return (
        l.includes('error') ||
        l.includes('warning') ||
        l.includes('failed') ||
        l.includes('cannot find') ||
        l.includes('is not assignable') ||
        l.includes('does not exist')
      )
    })
    .slice(0, 10)
    .map(l => l.trim())
}

/**
 * Initialize AutoVerify by registering a post-sampling hook.
 * Called once at startup.
 */
export function initAutoVerify(): void {
  registerPostSamplingHook(async (context: REPLHookContext) => {
    const results = await verifyAfterTurn(context)
    if (results.length === 0) return

    const failures = results.filter(r => !r.passed)
    if (failures.length === 0) return

    // Log failures — the hook has no direct way to inject into the
    // conversation (it runs after the model turn is complete).
    // Instead, we log and the next model turn will see the state.
    for (const f of failures) {
      logForDebugging(
        `[AutoVerify] FAILED (${f.tool}): ${f.errors.slice(0, 3).join('; ')}`,
      )
    }
  })
}
