import { registerBundledSkill } from '../bundledSkills.js'

const REFACTOR_SKILL_PROMPT = `# Refactor Skill — Safe Multi-Step Refactoring

Use this skill to plan and execute refactors with minimal risk.

## Process

### Step 1: Analyze
- Read the code to understand its current structure and responsibilities
- Identify public API surface (what depends on this code?)
- Search for all callers / usage sites
- Document the current behavior contract

### Step 2: Plan
\`\`\`
Target: <what are we refactoring to?>
Strategy: <extract module | rename | split function | migrate pattern>
Steps:
  1. <atomic step>
  2. <atomic step>
  3. <atomic step>
Rollback: <how to undo if something breaks>
\`\`\`

### Step 3: Execute (one step at a time)
1. Make ONE atomic change
2. Verify it compiles / typechecks
3. Run tests
4. Only then move to the next step

### Step 4: Validate
- No behavior change (outputs are identical)
- All existing tests pass
- No new TypeScript/Python/Rust errors
- Performance hasn't regressed

## Refactoring Patterns

### Extract Module
\`\`\`
// Before
function handleAllTheThings() { ... }

// After
import { auth, validate, format } from './lib/utils'
\`\`\`

### Rename (safe)
1. Rename definition
2. Update all call sites (use Grep to find them all)
3. Verify typecheck passes

### Split Large Function
1. Identify cohesive blocks (pure logic, validation, formatting, I/O)
2. Extract each block as a named function
3. Compose the original function from extracted parts

### Migrate Pattern
e.g., Callback → Promise, Class → Function, Redux → Zustand
1. Write adapter layer first (both APIs work)
2. Migrate consumers one by one
3. Remove adapter

## Anti-Patterns to Avoid
- Refactoring AND adding features in the same pass
- Premature abstraction (wait for 3+ occurrences)
- Renaming things without updating documentation
- Leaving dead code behind

## Rules
- One change at a time. Verify between each step.
- If a step takes >5 minutes, commit the intermediate state
- Prefer the Strangler Fig pattern for large refactors
- Keep a rollback plan
- Never refactor what's about to be rewritten anyway`

export function registerRefactorSkill(): void {
  registerBundledSkill({
    name: 'refactor',
    description:
      'Safe multi-step refactoring with migration planning, validation gates, and rollback strategy.',
    whenToUse:
      'Use when refactoring, restructuring, renaming, extracting modules, splitting large functions, or migrating between patterns. Use BEFORE making structural changes to plan the migration safely.',
    aliases: ['restructure', 'migrate', 'cleanup'],
    userInvocable: true,
    async getPromptForCommand(args) {
      const parts = [REFACTOR_SKILL_PROMPT]
      if (args) {
        parts.push(`## User Request\n\n${args}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
