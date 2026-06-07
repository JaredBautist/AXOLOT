import { registerBundledSkill } from '../bundledSkills.js'

const COMMIT_SKILL_PROMPT = `# Commit Skill — Conventional Commits + CHANGELOG

Use this skill to generate git commit messages following Conventional Commits and maintain a CHANGELOG.

## Process

1. **Read the diff** — \`git diff --staged\` (or \`git diff\` if nothing staged)
2. **Analyze changes** — categorise by type and scope
3. **Generate commit message** — Conventional Commits format
4. **Update CHANGELOG** — if a CHANGELOG.md exists

## Conventional Commits Format

\`\`\`
<type>(<scope>): <description>

[optional body]

[optional footer]
\`\`\`

### Types
- **feat**: A new feature
- **fix**: A bug fix
- **docs**: Documentation only changes
- **style**: Changes that do not affect the meaning of the code (formatting, missing semicolons, etc)
- **refactor**: A code change that neither fixes a bug nor adds a feature
- **perf**: A code change that improves performance
- **test**: Adding missing tests or correcting existing tests
- **chore**: Changes to the build process or auxiliary tools
- **ci**: Changes to CI configuration files and scripts

### Scope
The scope should be the module/component affected (e.g., auth, api, ui, db).

### Description
- Imperative present tense ("add" not "added" or "adds")
- Max 72 characters
- No period at the end

### Breaking Changes
Add \`!\` after the type/scope: \`feat(auth)!\`: or append \`BREAKING CHANGE:\` in the footer.

## CHANGELOG Format (Keep a Changelog)

\`\`\`markdown
# Changelog

## [Unreleased]

### Added
- ...

### Changed
- ...

### Fixed
- ...

## [1.0.0] - 2024-01-01

### Added
- Initial release
\`\`\`

## Rules
- If nothing is staged, ask the user what to include
- Group related changes into a single commit
- Don't commit half-baked or incomplete work
- If the CHANGELOG doesn't exist, offer to create it
- If there are breaking changes, highlight them in the commit AND the CHANGELOG`

export function registerCommitSkill(): void {
  registerBundledSkill({
    name: 'commit',
    description:
      'Generate Conventional Commit messages and maintain CHANGELOG based on git diff.',
    whenToUse:
      'Use when the user asks to commit changes, write a commit message, update the changelog, or prepare a pull request. Use BEFORE committing to analyze the diff and generate a proper message.',
    aliases: ['conventional-commit', 'changelog', 'git-commit'],
    userInvocable: true,
    async getPromptForCommand(args) {
      const parts = [COMMIT_SKILL_PROMPT]
      if (args) {
        parts.push(`## User Request\n\n${args}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
