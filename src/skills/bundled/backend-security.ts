import { registerBundledSkill } from '../bundledSkills.js'

const BACKEND_SECURITY_SKILL_PROMPT = `# Backend Security Skill — Auth, Authorization & Hardening

Use this skill when implementing authentication, authorization, or security hardening for backend systems.

## Authentication Patterns

### JWT (Stateless)
\`\`\`
Access Token: 15min (short-lived), sent in Authorization header
Refresh Token: 7-30 days, stored in httpOnly cookie or secure storage

Token payload (minimal):
{
  "sub": "user_123",
  "role": "admin",
  "iat": 1700000000,
  "exp": 1700000900
}
\`\`\`

### Session (Stateful)
- Server stores session, client gets session cookie
- Use secure, httpOnly, SameSite=Strict cookies
- Rotate session ID on login
- Implement session expiration and revocation

### OAuth 2.0 / OIDC
- Authorization Code + PKCE for web/mobile apps
- Client Credentials for server-to-server
- Validate the \`aud\` (audience) claim in tokens
- Use well-known libraries, never implement OAuth flows manually

## Authorization Models

| Model | When | How |
|---|---|---|
| RBAC | Simple roles (admin/user) | Predefined roles with permission sets |
| ABAC | Complex rules (region, time) | Attribute-based policies (AWS IAM-style) |
| ReBAC | Social/org relationships | Graph-based (e.g., Google Zanzibar) |

### Implementation
- Enforce at the middleware/gateway level, not in individual handlers
- Fail closed: deny by default, explicitly grant
- Check authorization on every request, not just at login

## OWASP Top 10 Prevention

| Vulnerability | Prevention |
|---|---|
| Injection (SQL, NoSQL) | Parameterized queries, ORM input sanitization |
| Broken Auth | Rate-limit login, bcrypt/argon2, MFA support |
| Sensitive Data Exposure | Encrypt at rest (AES-256), in transit (TLS 1.3) |
| XXE | Disable XML external entity processing |
| Broken Access Control | Server-side authorization checks (never trust client) |
| Security Misconfig | Default-deny firewall, minimal permissions |
| XSS | Content-Security-Policy header, output encoding |
| Insecure Deserialization | Use safe serializers (JSON > pickle), validate schemas |
| Known Vulnerabilities | Regular dependency audits (\`npm audit\`, \`pip audit\`, Dependabot) |
| Logging & Monitoring | Log auth failures, anomaly detection, alert on abuse |

## Security Headers
\`\`\`
Strict-Transport-Security: max-age=63072000
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Content-Security-Policy: default-src 'self'
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=()
\`\`\`

## API Security Checklist
- Rate limiting per endpoint (auth endpoints: stricter limits)
- Input validation on ALL request fields
- CORS: whitelist origins, don't use wildcard in production
- CSRF: use anti-CSRF tokens or SameSite cookies
- API keys: rotate regularly, scope to minimum permissions
- Logging: log auth events (login, logout, failures) with timestamps and IP
- Audit trail: record who did what and when (for compliance)

## Secrets Management
- Never hardcode secrets (API keys, DB passwords, tokens)
- Use environment variables with .env (never committed)
- Use a vault/secrets manager in production (Vault, AWS Secrets Manager)
- Rotate secrets on a schedule and on compromise
- Scan for secrets in code (\`git secrets\`, \`trufflehog\`, \`gitleaks\`)

## Rules
- Never trust client input: validate, sanitize, and authorize all requests server-side
- Use battle-tested libraries over custom implementations for crypto and auth
- The weakest link is usually human: document security procedures, do code reviews
- Encrypt everything in transit (TLS 1.3+)
- Hash passwords with bcrypt/argon2 (never MD5, SHA1, or plain SHA256)
- Implement least-privilege: each component gets only the access it needs
- Have a security incident response plan before you need it`

export function registerBackendSecuritySkill(): void {
  registerBundledSkill({
    name: 'backend-security',
    description:
      'Authentication, authorization, API security hardening, OWASP Top 10 prevention, and secrets management.',
    whenToUse:
      'Use when implementing auth (JWT, OAuth, sessions), setting up RBAC/ABAC, hardening API security, reviewing for OWASP vulnerabilities, or managing secrets. Use for security audit and penetration test preparation.',
    aliases: ['security', 'auth', 'oauth', 'jwt', 'owasp', 'hardening'],
    userInvocable: true,
    async getPromptForCommand(args) {
      const parts = [BACKEND_SECURITY_SKILL_PROMPT]
      if (args) {
        parts.push(`## User Request\n\n${args}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
