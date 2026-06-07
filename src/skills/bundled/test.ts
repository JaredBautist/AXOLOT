import { registerBundledSkill } from '../bundledSkills.js'

const TEST_SKILL_PROMPT = `# Test Skill — Write & Verify Tests

Use this skill when the task involves writing, running, or improving tests.

## Process

1. **Analyze the code** — read the module under test to understand its API, edge cases, and dependencies
2. **Check existing tests** — look at the test directory for patterns, fixtures, and test framework
3. **Identify test targets** — unit tests for pure logic, integration for I/O, e2e for critical paths
4. **Generate tests** — following the project's existing test conventions
5. **Run tests** — execute and fix failures
6. **Verify coverage** — check that new code is exercised

## Test Strategy by Type

### Unit Tests
- Test one function/component in isolation
- Mock external dependencies (DB, network, filesystem)
- Cover: happy path, error cases, edge cases (empty, null, boundary values)

### Integration Tests
- Test real interactions between 2-3 components
- Use test containers or fixtures for external services
- Cover: data flow, error propagation, contract between layers

### E2E Tests
- Test critical user journeys end-to-end
- Keep to 3-5 core flows (smoke test suite)
- Use dedicated staging/test environment

## Coverage Targets
- New code: >80% line coverage
- Critical paths: 100% (error handling, auth, payments)
- Existing code: don't reduce coverage

## Framework Detection

| Language | Unit | Integration | E2E |
|---|---|---|---|
| TypeScript | vitest, jest | vitest, jest | playwright, cypress |
| Python | pytest | pytest + docker | selenium, playwright |
| Rust | cargo test | cargo test | — |
| Go | go test | go test | — |

## Rules
- Don't write tests for trivial getters/setters
- Use the project's existing test framework & patterns
- Each test should have one clear assertion (or a small group of related ones)
- Name tests descriptively: \`describe('Module') / it('should handle X when Y')\`
- Run the test suite after writing; fix any failures before reporting done`

export function registerTestSkill(): void {
  registerBundledSkill({
    name: 'test',
    description:
      'Write, run, and improve tests — unit, integration, and e2e with coverage analysis.',
    whenToUse:
      'Use when the user asks to write tests, add test coverage, fix failing tests, set up a test framework, or improve test quality. Use for TDD workflows and test-driven development.',
    aliases: ['testing', 'unittest', 'tdd'],
    userInvocable: true,
    async getPromptForCommand(args) {
      const parts = [TEST_SKILL_PROMPT]
      if (args) {
        parts.push(`## User Request\n\n${args}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
