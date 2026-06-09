import { registerBundledSkill } from '../bundledSkills.js'

const DATABASE_SKILL_PROMPT = `# Database Skill — Schema Design, Migrations & Optimization

Use this skill when designing database schemas, writing migrations, optimizing queries, or modeling data.

## Process

1. **Understand the data** — entities, relationships, access patterns, volume
2. **Design the schema** — tables/collections, fields, types, constraints, indexes
3. **Plan migrations** — safe, reversible, tested
4. **Optimize queries** — EXPLAIN plans, N+1 detection, indexing strategy
5. **Review** — consistency, performance, migration safety

## Schema Design Principles

### Normalization (OLTP)
- 3NF by default: eliminate transitive dependencies
- Denormalize ONLY for proven read performance needs
- Every table needs a primary key (UUID or bigserial)
- Use foreign keys for referential integrity

### Naming Conventions
- Tables: plural snake_case (\`users\`, \`order_items\`)
- Columns: singular snake_case (\`created_at\`, \`email_address\`)
- PK column: \`id\`
- FK column: \`{table}_id\` (\`user_id\`, \`order_id\`)
- Indexes: \`idx_{table}_{column}\`
- Unique constraints: \`uq_{table}_{column}\`

### Types
- Prefer UUIDs over auto-increment for PKs (security, sharding)
- Use TIMESTAMPTZ for all timestamps
- JSONB for flexible payloads (but prefer normalized columns for queryable fields)
- Use ENUMs for fixed sets of values (but consider migration cost)

## Migration Patterns

### Safe Migrations
- All migrations must be reversible (up + down)
- One logical change per migration
- Never modify a migration that has been applied to production
- Add columns as NULLABLE first, backfill data, then add NOT NULL

### Zero-Downtime Pattern
\`\`\`sql
-- Step 1: Add column (no impact)
ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT false;

-- Step 2: Backfill in batches (application level)
UPDATE users SET email_verified = true WHERE email_verified IS NULL;

-- Step 3: Add NOT NULL (requires lock, do in low traffic)
ALTER TABLE users ALTER COLUMN email_verified SET NOT NULL;
\`\`\`

### Rollback Strategy
- Every up() migration must have a corresponding down()
- Test rollbacks in staging before production
- Keep migration files in version control

## Query Optimization

### Indexing Strategy
- Index columns used in WHERE, JOIN, ORDER BY, GROUP BY
- Composite indexes: order by cardinality (highest first), then equality, then range
- Covering indexes for frequent queries: include all selected columns
- Avoid over-indexing: every index slows writes

### N+1 Detection
- Identify in ORM queries: look for SELECT N+1 patterns
- Fix with eager loading (JOIN), DataLoader (GraphQL), or batch queries
- Monitor query count per request (target: <10 for typical endpoints)

### EXPLAIN Analysis
\`\`\`sql
EXPLAIN ANALYZE SELECT * FROM users WHERE email = 'test@example.com';
-- Look for: Seq Scan on large tables → add index
-- Look for: "rows" vs "actual rows" mismatch → stale statistics
\`\`\`

## Data Modeling by Database Type

| Database | Strengths | Best For |
|---|---|---|
| PostgreSQL | ACID, JSONB, extensions | Primary database, complex queries |
| MySQL | Simple, replicated widely | Read-heavy apps, WordPress |
| SQLite | Zero-config, single-file | Dev, mobile, embedded |
| MongoDB | Flexible schema, nested docs | Event sourcing, catalogs |
| Redis | In-memory, key-value | Caching, sessions, queues |

## Rules
- Start with normalized schema, denormalize only for measured performance
- Always add indexes for foreign keys and frequent query patterns
- Write migrations in pure SQL (avoid ORM migration generators in prod)
- Never SELECT * in production queries
- Use connection pooling in production
- Set statement timeouts at the connection level
- Log slow queries (>100ms) for optimization targets
- Test migrations on a copy of production data before deploying`

export function registerDatabaseSkill(): void {
  registerBundledSkill({
    name: 'database',
    description:
      'Database schema design, safe migrations, query optimization, indexing strategy, and data modeling.',
    whenToUse:
      'Use when designing database schemas, writing migrations, optimizing slow queries, modeling data relationships, or debugging N+1 problems. Use for SQL review and indexing advice.',
    aliases: ['db', 'sql', 'schema', 'migration', 'query', 'data-model'],
    userInvocable: true,
    async getPromptForCommand(args) {
      const parts = [DATABASE_SKILL_PROMPT]
      if (args) {
        parts.push(`## User Request\n\n${args}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
