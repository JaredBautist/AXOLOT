import { registerBundledSkill } from '../bundledSkills.js'

const LEARN_SKILL_PROMPT = `# Learn Skill — Adaptive Skill Routing & RAG Memory

Use this skill to inspect and manage Axolot's local learning system.

The learning system stores project-local state in \`.axolot/learning/state.json\`:
- \`profile\` — preferred/avoided skills and concise routing notes
- \`skillStats\` — usage counts, recency, and deterministic local embeddings
- \`memories\` — short RAG-style memories with tags and local embeddings

## Commands

### \`/learn status\`
Read \`.axolot/learning/state.json\` and summarize:
- number of learned memories
- top skills by usage
- preferred and avoided skills
- recent profile notes

### \`/learn remember <text>\`
Add a short memory to \`.axolot/learning/state.json\`.
Rules:
- Keep the memory under 300 characters
- Add 1-5 lowercase tags
- Do not store secrets, tokens, passwords, private keys, or unrelated personal data
- Prefer project/workflow lessons, user preferences, and tool gotchas

### \`/learn prefer <skill>\`
Add a skill name to \`profile.preferredSkills\` and remove it from \`profile.avoidedSkills\`.

### \`/learn avoid <skill>\`
Add a skill name to \`profile.avoidedSkills\` and remove it from \`profile.preferredSkills\`.

### \`/learn note <text>\`
Append a concise routing note to \`profile.notes\`. Keep at most 50 notes.

### \`/learn suggest <request>\`
Read available commands/skills and the learning state, then explain which skills should be used for the request and why.

### \`/learn reset\`
Ask for explicit confirmation before clearing \`.axolot/learning/state.json\`.

## Implementation Rules
- Use Read/Edit/Write tools for \`.axolot/learning/state.json\`; create parent directories if missing
- Preserve unknown fields when editing existing state
- Keep JSON valid and formatted with two spaces
- Never put raw secrets in learning memory
- Treat learning as a routing prior, not an override of explicit user instructions`

export function registerLearnSkill(): void {
  registerBundledSkill({
    name: 'learn',
    description:
      'Manage local learning profile, skill routing preferences, and RAG-style memories in .axolot/learning/.',
    whenToUse:
      'Use when the user asks Axolot to learn, remember workflow lessons, improve skill suggestions, inspect adaptive routing, prefer/avoid a skill, or manage learning memory.',
    aliases: ['learning', 'memory-router', 'skill-router', 'teach'],
    userInvocable: true,
    async getPromptForCommand(args) {
      const parts = [LEARN_SKILL_PROMPT]
      if (args) {
        parts.push(`\n## User Request\n\n${args}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
