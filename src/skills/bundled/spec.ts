import { registerBundledSkill } from '../bundledSkills.js'

const SPEC_SKILL_PROMPT = `# Spec Skill — Spec-Driven Development

Manages the project's \`.claudex/\` directory for Spec-Driven Development (SDD).
This system keeps requirements, design decisions, tasks, and session memory version-controlled alongside the code.

## Directory Structure

\`\`\`
.claudex/
  SPEC.md          # Main spec — requirements, design, tasks
  memory/           # Session logs (YYYY-MM-DD.md)
    MEMORY.md       # Curated long-term project memory
\`\`\`

## Commands

### \`/spec init\`
Scaffold \`.claudex/\` in the project root (CWD). Creates SPEC.md with a template covering:
- **Requirements**: functional + non-functional, acceptance criteria
- **Design**: architecture, data model, component tree, API contracts
- **Tasks**: backlog with status (pending/in-progress/done/cancelled)

If SPEC.md already exists, re-reads it and reports current state.

### \`/spec\` (no args)
Reads the current \`.claudex/SPEC.md\` and reports the project status — what's defined, what's in progress, what's done.

### \`/spec update\`
Re-reads the current SPEC.md, reconciles with what you've learned from reading the actual codebase, and writes an updated version. Use this when:
- You discover requirements not yet documented
- Architecture decisions change during implementation
- Tasks get completed or new ones appear

### \`/spec add-requirement <description>\` or \`/spec req <description>\`
Appends a new requirement to the Requirements section and marks it as pending.

### \`/spec task <description>\`
Appends a new implementation task to the Tasks section.

### \`/spec done <task-name>\`
Marks a task as completed (moves from pending/in-progress to done).

### \`/spec design <description>\`
Appends a design decision to the Design section.

## SPEC.md Format Template

\`\`\`markdown
# Project Spec

## Requirements

### Functional
- REQ-001: As a [user], I want [feature] so that [benefit]
  - Status: pending | in-progress | done
  - Priority: high | medium | low

### Non-Functional
- NF-001: [performance/scalability/security requirement]
  - Status: pending | in-progress | done

## Design

### Architecture
- Overall approach, key patterns, technology choices

### Data Model
- Entities, relationships, data flow

### API / Contracts
- Interfaces between components

### Decisions
- ADR-001: [decision] — context, trade-offs, chosen approach

## Tasks

- [ ] TSK-001: [description] (priority, area)
- [x] TSK-002: [completed task]
- [-] TSK-003: [cancelled task]
\`\`\`

## Rules
- Never overwrite existing work in SPEC.md — always append or update
- Before any non-trivial implementation, check SPEC.md for existing requirements
- When completing a task, update SPEC.md to mark it done
- Log session notes to \`.claudex/memory/YYYY-MM-DD.md\` at the end of each session
- Keep MEMORY.md in \`.claudex/memory/\` for cross-session curated knowledge`

export function registerSpecSkill(): void {
  registerBundledSkill({
    name: 'spec',
    description:
      'Spec-Driven Development: scaffold and manage .claudex/ with requirements, design, tasks, and session memory.',
    whenToUse:
      'Use at the start of a project to scaffold specs. Use before any implementation to read existing specs. Use during implementation to update progress. Use at session end to log memories.',
    aliases: ['sdd', 'project-spec', 'requirements', 'scaffold'],
    userInvocable: true,
    async getPromptForCommand(args) {
      const parts = [SPEC_SKILL_PROMPT]
      if (args) {
        parts.push(`## User Request\n\n${args}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
