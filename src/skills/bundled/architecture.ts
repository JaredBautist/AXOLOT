import { registerBundledSkill } from '../bundledSkills.js'

const ARCHITECTURE_SKILL_PROMPT = `# Architecture Skill — System Design & Planning

Use this skill when designing system architecture, making trade-off decisions, or documenting architectural decisions.

## Process

1. **Understand requirements** — functional and non-functional (scale, latency, availability, cost)
2. **Identify constraints** — team size, timeline, existing tech stack, budget
3. **Explore current architecture** — read existing code, configs, and docs
4. **Propose options** — 2-3 architectural approaches with trade-offs
5. **Document decision** — Architecture Decision Record (ADR) format

## ADR Template

\`\`\`markdown
# ADR-<NNN>: <Title>

## Status
Proposed | Accepted | Deprecated | Superseded

## Context
What's the problem? What constraints exist?

## Decision
What did we choose and why?

## Consequences
What becomes easier/harder? What trade-offs did we accept?

## Alternatives Considered
1. **Option A** — pros, cons, why not chosen
2. **Option B** — pros, cons, why not chosen
\`\`\`

## Architecture Concerns Checklist

- **Scalability**: horizontal vs vertical, read vs write throughput
- **Reliability**: fault tolerance, redundancy, backup strategy
- **Maintainability**: code organization, module boundaries, tech debt
- **Security**: auth, data privacy, dependency trust
- **Cost**: compute, storage, network, operational overhead
- **Performance**: latency budgets, caching strategy, query optimization
- **Observability**: logging, metrics, tracing, alerting
- **Testing**: testability of the architecture, mocking complexity

## Documentation Artifacts

- **System diagram** — \`\`\`mermaid graph TD ... \`\`\` for component relationships
- **Data flow** — \`\`\`mermaid sequenceDiagram ... \`\`\` for request lifecycles
- **ADR** — one per significant decision
- **README** — updated with new architecture overview

## Rules
- Start with the simplest workable architecture; avoid premature distribution
- Prefer well-known patterns over novel ones (more community knowledge)
- Document WHY, not just WHAT
- If an ADR already exists for a related decision, reference it`

export function registerArchitectureSkill(): void {
  registerBundledSkill({
    name: 'architecture',
    description:
      'System design, Architecture Decision Records, trade-off analysis, and technical planning.',
    whenToUse:
      'Use for system architecture design, tech stack decisions, scalability planning, documenting ADRs, evaluating trade-offs, creating system diagrams, or when asked "how should we design this?".',
    aliases: ['arch', 'design', 'adr', 'system-design'],
    userInvocable: true,
    async getPromptForCommand(args) {
      const parts = [ARCHITECTURE_SKILL_PROMPT]
      if (args) {
        parts.push(`## User Request\n\n${args}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
