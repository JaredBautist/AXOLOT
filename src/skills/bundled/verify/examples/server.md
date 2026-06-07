# Server Project Verification Example

For a web server project:

```bash
# Lint + format
npm run lint && npm run format:check

# Typecheck
npx tsc --noEmit

# Run tests with coverage
npm test -- --coverage

# Build
npm run build

# Start server and health check
npm start &
sleep 2
curl -f http://localhost:3000/health && echo "OK"
kill %1
```
