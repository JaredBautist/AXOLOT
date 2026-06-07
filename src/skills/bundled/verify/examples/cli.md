# CLI Project Verification Example

For a Node.js CLI project:

```bash
# Lint
npm run lint

# Typecheck
npx tsc --noEmit

# Run unit tests (filter by changed module)
npx vitest run --related src/my-changed-file.ts

# Build
npm run build

# Quick smoke test
node dist/index.js --help
```
