import { registerBundledSkill } from '../bundledSkills.js'

const SESSION_SKILL_PROMPT = `# Session Skill — Persist & Restore State

Manages session state in \`.axolot/session.json\` so you can pick up where you left off across sessions.

## State File Format
\`\`\`json
{
  "task": "Current task description",
  "files": ["src/file1.ts", "src/file2.ts"],
  "context": "Brief summary of progress, decisions, blockers",
  "focus": "What to work on next"
}
\`\`\`

## Commands

### \`/session save [summary]\`
Save current session state to \`.axolot/session.json\`. Include what you were working on, files changed, and next steps.

### \`/session status\`
Show saved session state if one exists.

### \`/session resume\`
Read \`.axolot/session.json\` and restore context: load files mentioned in "files", re-read relevant code, and continue the task.

### \`/session clear\`
Delete the saved session state. Use when a task is fully complete.

## Rules
- Call \`/session save\` at the end of any significant session
- Call \`/session resume\` at the start of a new session if session.json exists
- The context field should be concise (2-3 sentences max)
- Include file paths relative to project root`

export function registerSessionSkill(): void {
  registerBundledSkill({
    name: 'session',
    description:
      'Persist session state to .axolot/session.json and restore it across sessions.',
    whenToUse:
      'Use at session start to check for saved state. Use at session end to save progress. Use when the user says "continue where I left off" or similar.',
    aliases: ['state', 'resume', 'checkpoint', 'continue'],
    userInvocable: true,
    async getPromptForCommand(args) {
      const parts = [SESSION_SKILL_PROMPT]
      if (args) {
        parts.push(`\n## User Request\n\n${args}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
