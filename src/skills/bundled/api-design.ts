import { registerBundledSkill } from '../bundledSkills.js'

const API_DESIGN_SKILL_PROMPT = `# API Design Skill — REST, GraphQL & OpenAPI

Use this skill when designing, implementing, or documenting API endpoints.

## Process

1. **Understand the domain** — what resource/action is being exposed?
2. **Choose API style** — REST (resource-oriented) vs GraphQL (query-oriented) vs gRPC (service-oriented)
3. **Design the contract** — OpenAPI/Swagger spec first (design-driven development)
4. **Implement** — handlers, validation, serialization, error handling
5. **Document** — auto-generate OpenAPI, keep docs in sync with code

## REST API Conventions

### URL Structure
- Plural nouns for resources: \`/api/v1/users\`, \`/api/v1/orders\`
- Nest for sub-resources: \`/api/v1/users/{id}/posts\`
- Query params for filtering/pagination: \`?status=active&page=1&limit=20\`
- Kebab-case for multi-word paths: \`/api/v1/order-items\`

### HTTP Methods & Status Codes
| Method | Action | Success | Error |
|---|---|---|---|
| GET | List/Retrieve | 200 OK | 404 Not Found |
| POST | Create | 201 Created | 400 Bad Request |
| PUT | Replace | 200 OK | 409 Conflict |
| PATCH | Partial Update | 200 OK | 422 Unprocessable |
| DELETE | Remove | 204 No Content | 404 Not Found |

### Response Envelope
\`\`\`json
{
  "data": { ... },
  "meta": { "page": 1, "total": 42 },
  "error": null
}
\`\`\`

### Error Response
\`\`\`json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Email is required",
    "details": [ { "field": "email", "reason": "required" } ]
  }
}
\`\`\`

## GraphQL Conventions
- Schema-first design: define types before resolvers
- Use DataLoader for N+1 prevention
- Mutations return the modified object + client mutation ID
- Pagination: Connection spec (edges/node/cursor)

## OpenAPI / Swagger
- Write spec before implementation for complex endpoints
- Include: paths, schemas, parameters, responses, security schemes
- Use tools: openapi-generator, swagger-codegen, or manual with scrutiny
- Keep spec versioned alongside code

## Implementation Patterns

### Validation
- Validate at the boundary (request parsing layer)
- Use schema validation library (Zod for TS, Pydantic for Python)
- Never trust client input — validate types, ranges, and formats

### Authentication
- Accept tokens via \`Authorization: Bearer <token>\` header
- Validate token in middleware before handlers
- Return 401 for missing/invalid, 403 for insufficient permissions

### Rate Limiting
- Apply per-user/IP: token bucket or sliding window
- Return headers: \`X-RateLimit-Limit\`, \`X-RateLimit-Remaining\`, \`X-RateLimit-Reset\`
- Return 429 Too Many Requests with \`Retry-After\`

### Versioning
- URL prefix: \`/api/v1/\`, \`/api/v2/\`
- Deprecate gradually: serve both versions, mark old as deprecated
- Document breaking changes per version

## Rules
- Design the API contract before writing implementation code
- Use consistent error format across ALL endpoints
- Never expose internal IDs or implementation details in responses
- Keep handlers thin — move logic to service layer
- Paginate all list endpoints (default page size, max page size)
- Log all requests (method, path, status, duration, user-id)
- Write integration tests for every endpoint (happy + error paths)`

export function registerApiDesignSkill(): void {
  registerBundledSkill({
    name: 'api-design',
    description:
      'REST/GraphQL API design, OpenAPI specs, endpoint implementation with validation, error handling, and versioning.',
    whenToUse:
      'Use when designing new API endpoints, implementing REST/GraphQL handlers, writing OpenAPI specs, or reviewing API contracts. Use for API versioning strategies and endpoint refactoring.',
    aliases: ['api', 'rest', 'graphql', 'openapi', 'endpoint'],
    userInvocable: true,
    async getPromptForCommand(args) {
      const parts = [API_DESIGN_SKILL_PROMPT]
      if (args) {
        parts.push(`## User Request\n\n${args}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
