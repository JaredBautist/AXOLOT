import { registerBundledSkill } from '../bundledSkills.js'

const DOCS_SKILL_PROMPT = `# Docs Skill — Generate & Update Documentation

Use this skill to create or update project documentation by reading the actual code.

## Process

1. **Read the code** — understand what the module/API/component does
2. **Check existing docs** — see what's already documented
3. **Identify audience** — end-user? contributor? API consumer?
4. **Generate docs** — following the project's existing doc style
5. **Link to code** — cross-reference source locations

## Documentation Types

### README
- What: one-paragraph project description
- Why: problem it solves
- How: quick start (install, configure, run)
- Where: API docs, contributing guide, license

### API Documentation
- Function signatures with typed params
- Return values and possible errors
- Usage examples (copy-paste ready)
- Edge cases and gotchas

### Changelog
- Format: \`## [version] - YYYY-MM-DD\`
- Categories: Added, Changed, Deprecated, Removed, Fixed, Security
- One line per meaningful change
- Link to relevant issues/PRs

### Contributing Guide
- Setup instructions
- Development workflow (lint, test, build)
- PR process and conventions
- Code style expectations

### Inline Documentation
- Public API: JSDoc / docstrings (what + why, not how)
- Complex logic: explain WHY the approach was chosen
- TODO/FIXME: include issue reference

## Quality Checklist
- [ ] Accurate? (verified against actual code)
- [ ] Complete? (all public APIs documented)
- [ ] Usable? (examples are copy-pasteable)
- [ ] Current? (reflects the actual code, not outdated assumptions)

## Rules
- Don't document what's obvious from the code (type signatures, obvious params)
- Do document WHY (design decisions, trade-offs, historical context)
- Keep examples minimal and focused
- Use the project's existing documentation style and format
- If updating docs, read the old version first to preserve valuable information`

export function registerDocsSkill(): void {
  registerBundledSkill({
    name: 'docs',
    description:
      'Generate and update project documentation: README, API docs, changelogs, contributing guides.',
    whenToUse:
      'Use when writing or updating README files, API documentation, changelogs, contributing guides, inline documentation, or when asked "document this" or "add docs".',
    aliases: ['documentation', 'readme', 'changelog'],
    userInvocable: true,
    async getPromptForCommand(args) {
      const parts = [DOCS_SKILL_PROMPT]
      if (args) {
        parts.push(`## User Request\n\n${args}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
