import { registerBundledSkill } from '../bundledSkills.js'

const DEPLOY_SKILL_PROMPT = `# Deploy Skill — CI/CD, Docker & Infrastructure

Use this skill when setting up deployment pipelines, containerizing applications, configuring CI/CD, or planning infrastructure.

## Process

1. **Understand the application** — language, framework, dependencies, entry points
2. **Choose deployment model** — container (Docker), serverless, PaaS, or VM
3. **Set up CI/CD** — build → test → deploy pipeline
4. **Configure infrastructure** — compute, networking, storage, secrets
5. **Plan monitoring** — health checks, logging, alerts
6. **Document rollback** — how to revert a bad deployment

## Docker Best Practices

### Dockerfile
\`\`\`dockerfile
# Multi-stage build: separate build vs runtime
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
USER node
CMD ["node", "dist/index.js"]
\`\`\`

### Image Best Practices
- Use specific version tags (not \`:latest\`)
- Multi-stage builds to minimize image size
- Run as non-root user
- Use \`.dockerignore\` to exclude unnecessary files
- Scan images for vulnerabilities (Trivy, Snyk)

## CI/CD Pipeline Patterns

### GitHub Actions Structure
\`\`\`yaml
name: CI/CD
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test

  deploy:
    needs: [test]
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - run: ./deploy.sh  # your deploy script
\`\`\`

### Pipeline Stages
1. **Lint & typecheck** — static analysis only (fast)
2. **Unit tests** — isolated, fast, parallelizable
3. **Build** — compile, bundle, dockerize
4. **Integration tests** — depends on external services
5. **Deploy to staging** — canary or blue/green
6. **Smoke tests** — verify deployment is healthy
7. **Deploy to production** — gradual rollout

## Deployment Strategies

| Strategy | Risk | Speed | Zero-Downtime | Best For |
|---|---|---|---|---|
| Blue/Green | Low | Fast | Yes | Web apps, APIs |
| Canary | Medium | Gradual | Yes | ML models, risky changes |
| Rolling | Medium | Moderate | Yes | Clustered services |
| Recreate | High | Fast | No | Dev, staging |
| Serverless | Low | Instant | Yes | Event-driven, APIs |

### Health Check Requirements
- Endpoint: \`GET /health\` returns 200 with uptime + dependency status
- Readiness: application is ready to serve traffic
- Liveness: application is alive (simple ping)
- Startup: for slow-starting containers (initial startup grace period)

## Infrastructure Checklist
- **Secrets**: use a secrets manager (not env files in repo)
- **Environment**: separate dev/staging/prod, each with own config
- **Logs**: centralized logging (structured JSON logs)
- **Metrics**: CPU, memory, request latency, error rate
- **Alerting**: on error rate spikes, latency degradation, downtime
- **Backups**: automated DB backups with retention policy
- **DNS**: CNAME/ALIAS record, SSL certificate auto-renewal
- **Rate limiting**: at the reverse proxy level (Nginx, AWS WAF)

## Rules
- Automate everything: no manual deploy steps
- Every deployment must be reproducible from version control
- Tag container images with git SHA for traceability
- Deploy to staging first, smoke test, then production
- Document rollback procedure in README
- Use infrastructure-as-code (Terraform, Pulumi, CloudFormation)
- Monitor the deploy itself: track deploy frequency, failure rate, recovery time`

export function registerDeploySkill(): void {
  registerBundledSkill({
    name: 'deploy',
    description:
      'CI/CD pipelines, Docker containerization, deployment strategies, and infrastructure configuration.',
    whenToUse:
      'Use when setting up Docker, CI/CD pipelines, deployment workflows, containerization, rolling back deployments, or planning infrastructure. Use for GitHub Actions, Dockerfiles, and cloud deploy config.',
    aliases: ['ci', 'cd', 'cicd', 'docker', 'infrastructure', 'pipeline'],
    userInvocable: true,
    async getPromptForCommand(args) {
      const parts = [DEPLOY_SKILL_PROMPT]
      if (args) {
        parts.push(`## User Request\n\n${args}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
