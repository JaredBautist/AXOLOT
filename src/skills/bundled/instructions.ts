import { registerBundledSkill } from '../bundledSkills.js'

const INSTRUCTIONS_SKILL_PROMPT = `# Instructions Skill — Personalized Project Rules

Manages custom instructions in \`.axolot/instructions/\`. These files are automatically loaded each turn and injected into the system prompt.

## Commands

### \`/instructions init\`
Create \`.axolot/instructions/\` directory with a sample file.

### \`/instructions add <name> <content>\`
Create a new instruction file. Examples:
- \`/instructions add coding-style "Use functional components with hooks. No class components."\`
- \`/instructions add api-rules "All API calls go through the service layer. Never fetch directly in components."\`

### \`/instructions list\`
List all active instruction files.

### \`/instructions remove <name>\`
Remove an instruction file.

### \`/instructions edit <name> <content>\`
Replace the content of an existing instruction file.

## Format
Each file in \`.axolot/instructions/\` is a markdown file. The filename becomes the section header.
\`\`\`
.axolot/instructions/
  coding-style.md       # "## Coding Style\\nUse functional components..."
  api-conventions.md    # "## API Conventions\\nAll endpoints use..."
  testing-rules.md      # "## Testing\\nMinimum 80% coverage..."
\`\`\`

## Rules
- Keep instructions concise and actionable
- Max 10 instruction files to avoid bloating context
- Order matters: files are loaded alphabetically
- Use for project-specific rules that shouldn't go into AGENTS.md or MEMORY.md`

export function registerInstructionsSkill(): void {
  registerBundledSkill({
    name: 'instructions',
    description:
      'Manage personalized project rules in .axolot/instructions/. Files are auto-loaded each turn.',
    whenToUse:
      'Use when the user wants to set project-specific rules, coding conventions, branching strategy, or any persistent instructions. Use when the user asks about project setup or conventions.',
    aliases: ['project-rules', 'custom-instructions', 'conventions'],
    userInvocable: true,
    async getPromptForCommand(args) {
      const parts = [INSTRUCTIONS_SKILL_PROMPT]
      if (args) {
        parts.push(`\n## User Request\n\n${args}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
