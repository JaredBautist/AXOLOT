import { registerBundledSkill } from '../bundledSkills.js'

const TOKEN_SAVER_PROMPT = `# Token Saver — Smart Token Optimization

Optimize token consumption by making intelligent decisions about what to process and how.

## Mode Selector

Use \`/token-saver [mode]\` to set a mode:

| Mode | When to use | Effect |
|------|-------------|--------|
| \`auto\` | Default — balances cost vs quality | Model decides per task |
| \`eco\` | Simple/exploratory tasks | Skip non-essential reading, concise output, effort low |
| \`turbo\` | Deep work, complex refactors | Full context, effort high, but still avoid waste |
| \`budget\` | You have a token limit | Set budget via \`/token-saver budget +500k\` |

Without arguments, analyzes current session and gives token-saving advice.

## Token-Saving Directives

When this skill is active, follow these rules:

### 1. Smart File Selection

Before reading files, STOP and think:
- Do I NEED this file, or am I reading it "just in case"?
- Can I use \`grep\` with a narrow pattern instead of reading the whole file?
- Can I read only the relevant function/class (offset + limit)?
- If the task is narrow, DON'T read the whole project structure — start with the specific area

**Rules:**
- Never read entire directories unless you need to discover structure
- Never read package.json/tsconfig.json if you already know the project setup
- Use targeted Grep before full Read
- For large files (>200 lines), use offset + limit to read only what you need
- If a file import appears irrelevant to the task, skip reading it

### 2. Effort Level Tuning

Suggest /effort based on task complexity:

| Task Type | Recommended Effort |
|-----------|-------------------|
| Typo fix, simple rename, one-line change | \`/effort low\` |
| Small feature, single file change | \`/effort normal\` |
| Multi-file feature, bug with investigation | \`/effort high\` |
| Complex architecture, cross-cutting change | \`/effort max\` |

\texttt{/effort low} can reduce output tokens by ~40-60% vs \texttt{high}.

### 3. Concise Output Rules

- Answer directly. No preamble like "Let me look into this" or "I'll help you with that"
- No restating the question — just give the answer
- One sentence where three would do
- Skip transitional phrases ("In other words", "Furthermore", "However")
- No self-praise or meta-commentary ("Great question!", "That's a good approach")
- For simple commands: just show the command, don't explain it unless asked
- No summaries unless the user explicitly asks for one
- When a tool call is obviously the next step, just make it — no text before

### 4. Skip Irrelevant Work

Before executing any action, ask:
1. Is this directly related to the user's request?
2. Am I adding error handling for edge cases that can't happen?
3. Am I refactoring beyond what was asked?
4. Am I adding comments/docstrings that weren't requested?
5. Am I exploring the codebase beyond what's necessary?

If any answer is "yes", STOP. Do only what was asked.

### 5. Token Budget Management

When the user specifies a token budget:
- \`/token-saver budget +500k\` — set target of +500K output tokens
- Track output token count per turn
- If approaching budget, prioritize remaining work
- If budget is far away, don't artificially inflate — just work efficiently

### 6. Batch Operations

Reduce overhead by batching:
- Combine multiple reads into one tool call
- Combine multiple edits into one tool call when possible
- Process independent tasks in parallel (multi-agent)
- One Grep with broader pattern > multiple narrow Greps

## Auto-Suggestion

This skill activates when:
- User mentions "tokens", "cost", "budget", "save", "efficiency"
- User asks about controlling API spend
- User complains about slow/expensive responses
- Task looks like it would consume excessive tokens (full-project analysis, large refactors)
`

export function registerTokenSaverSkill(): void {
  registerBundledSkill({
    name: 'token-saver',
    description:
      'Smart token optimization: skip irrelevant files, tune effort, enforce conciseness, and manage token budgets.',
    whenToUse:
      'Use when the user asks about token consumption, API cost, efficiency, or when the task might waste tokens. Use proactively if the session is consuming many tokens.',
    aliases: ['tokens', 'cost-saver', 'efficient', 'budget', 'token-budget'],
    userInvocable: true,
    async getPromptForCommand(args) {
      let prompt = TOKEN_SAVER_PROMPT
      if (args) {
        prompt += `\n\n## User Request\n\n${args}`
      }
      return [{ type: 'text', text: prompt }]
    },
  })
}
