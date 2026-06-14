import { registerBundledSkill } from '../bundledSkills.js'

const ONBOARD_SKILL_PROMPT = `# Onboard Skill — First Steps Guide

Use this skill to guide new users through setting up and using Axolot for the first time.

## Onboarding Flow

### Step 1: Choose a Provider
Ask the user which AI provider they want to use:
- **Anthropic**: Best for coding, long context, tool use — recommended
- **OpenAI (ChatGPT)**: Fast, widely available, good all-around
- **Gemini (Google)**: Free tier available, good for experimentation

### Step 2: Configure Authentication
Guide the user through authentication:

**For API Key:**
\`\`\`sh
axolot auth <provider>
# Then paste your API key when prompted
\`\`\`

**Or set environment variable:**
\`\`\`sh
export ANTHROPIC_API_KEY="sk-..."
export OPENAI_API_KEY="sk-..."
export GEMINI_API_KEY="..."
\`\`\`

### Step 3: Select Model
\`\`\`sh
# See available models
axolot use <provider>

# Set a specific model
axolot use anthropic sonnet
axolot use openai gpt-4o
axolot use gemini gemini-2.5-pro
\`\`\`

Or inside the TUI, use \`/model\` to interactively choose provider and model.

### Step 4: Try Your First Prompt
\`\`\`sh
# Quick chat (no TUI)
axolot chat "hello, who are you?"

# Open the TUI
axolot
\`\`\`

### Step 5: Learn the Skills
Inside the TUI, use \`/<skill-name>\` to invoke a skill:

| Skill | What it does |
|---|---|
| \`/verify\` | Run lint → typecheck → test → build |
| \`/test\` | Write and run tests |
| \`/review\` | PR-level code review |
| \`/refactor\` | Safe multi-step refactoring |
| \`/architecture\` | System design & ADRs |
| \`/docs\` | Generate documentation |
| \`/commit\` | Conventional commits + CHANGELOG |
| \`/simplify\` | Code quality review |
| \`/codex-frontend-master\` | Frontend quality standards |
| \`/ui-ux-pro-max\` | UI/UX design intelligence |

### Step 6: Configure Effort
Control token usage and response depth:
\`\`\`text
/effort normal   (recommended default)
/effort low      (quick answers, less tokens)
/effort high     (thorough analysis)
/effort max      (maximum depth)
\`\`\`

## Rules
- Be friendly and patient — this might be the user's first time with an AI CLI
- Offer choices instead of assuming
- Verify the setup works (run a test prompt) before declaring success
- If something fails, help debug — check API key validity, network, PATH
- Point to \`axolot --help\` for CLI reference, \`/help\` inside TUI for slash commands`

export function registerOnboardSkill(): void {
  registerBundledSkill({
    name: 'onboard',
    description:
      'Interactive first-steps guide: provider setup, authentication, model selection, and skill discovery.',
    whenToUse:
      'Use when the user seems new to Axolot: asks "how do I start", "how to configure", "first time", "setup", "help getting started", or when no provider is configured yet.',
    aliases: ['setup', 'getting-started', 'welcome', 'help'],
    userInvocable: true,
    async getPromptForCommand(args) {
      const parts = [ONBOARD_SKILL_PROMPT]
      if (args) {
        parts.push(`## User Request\n\n${args}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
