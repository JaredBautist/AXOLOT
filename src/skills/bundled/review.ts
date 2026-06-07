import { registerBundledSkill } from '../bundledSkills.js'

const REVIEW_SKILL_PROMPT = `# Review Skill — PR-Level Code Review

Use this skill for thorough code review of diffs, PRs, or proposed changes.

## Review Phases

### 1. Understand the Change
- Read the diff carefully
- Understand what problem it solves
- Check if tests exist for the change

### 2. Security Review
- **Injection**: SQL, command, XSS — are inputs sanitized?
- **Auth**: are permissions checked? Is the principle of least privilege followed?
- **Secrets**: any hardcoded keys, tokens, or credentials?
- **Dependencies**: any known-vulnerable packages added or updated?
- **Data exposure**: sensitive data in logs, URLs, or error messages?

### 3. Quality Review
- **Correctness**: does the code do what it intends?
- **Edge cases**: empty states, null handling, boundary values
- **Error handling**: are errors caught, logged, and surfaced appropriately?
- **Concurrency**: thread safety, race conditions, deadlocks
- **Performance**: N+1 queries, unnecessary allocations, large payloads

### 4. Maintainability Review
- **Naming**: clear function/variable names, consistent with codebase
- **Structure**: appropriate abstraction level, single responsibility
- **Comments**: meaningful comments (why, not what), no commented code
- **Duplication**: unnecessary duplication vs premature abstraction

### 5. Dependency Review
- **New deps**: necessary? Well-maintained? License compatible?
- **Version changes**: breaking changes? Security advisories?

## Output Format

For each issue found, use this format:

> **Severity** | **Category** | **File:Line**
> **Issue**: description
> **Suggestion**: concrete fix recommendation

Severity levels:
- **BLOCKER**: must fix before merge (security, data loss, correctness)
- **MAJOR**: should fix (maintainability, edge cases)
- **MINOR**: nice to have (style, naming)
- **PRAISE**: notable good practice

## Rules
- Be constructive. Every critique should have a suggestion.
- Start with what's good about the change
- Distinguish between objective problems and subjective preferences
- Don't block on style if the project has a formatter
- Check if the diff is easily revertible and independently deployable`

export function registerReviewSkill(): void {
  registerBundledSkill({
    name: 'review',
    description:
      'Thorough code review: security, quality, maintainability, dependencies.',
    whenToUse:
      'Use for PR review, code review requests, checking for security issues, dependency review, or when the user asks "review this code" or "check my PR".',
    aliases: ['code-review', 'pr-review', 'audit'],
    userInvocable: true,
    async getPromptForCommand(args) {
      const parts = [REVIEW_SKILL_PROMPT]
      if (args) {
        parts.push(`## User Request\n\n${args}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
