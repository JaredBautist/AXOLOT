import { registerBundledSkill } from '../bundledSkills.js'

const SELF_TEST_SKILL_PROMPT = `# Self-Test Skill — Claudex Code Quality

Run quality checks on the Claudex project itself.

## Commands

### \`/self-test\`
Run the full test suite:
1. \`tsc --noEmit\` typecheck
2. \`bun run build\` build
3. Check for common issues (missing files, broken imports, etc.)

### \`/self-test typecheck\`
Run only the TypeScript typecheck.

### \`/self-test build\`
Run only the build step.

### \`/self-test analyze\`
Analyze code quality:
- Check for files >500 lines (code smell)
- Check for missing exports in index files
- Check for unused imports
- Report dependency health

## Process
1. Read project structure to understand current state
2. Run requested checks
3. Report results with clear pass/fail
4. On failure, diagnose and suggest fixes

## Rules
- Always run typecheck BEFORE build
- Report errors with file paths and line numbers
- Group related errors together
- Suggest concrete fixes for each issue found`

export function registerSelfTestSkill(): void {
  registerBundledSkill({
    name: 'self-test',
    description:
      'Run quality checks on the Claudex project: typecheck, build, code analysis.',
    whenToUse:
      'Use when the user asks to test, verify, or check Claudex itself. Use before committing changes to Claudex.',
    aliases: ['check', 'verify-claudex', 'claudex-check'],
    userInvocable: true,
    async getPromptForCommand(args) {
      const parts = [SELF_TEST_SKILL_PROMPT]
      if (args) {
        parts.push(`\n## User Request\n\n${args}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
