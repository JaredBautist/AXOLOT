---
description: Verify that code changes work correctly by running tests, linters, type-checkers, and the application itself. Use after any non-trivial edit to confirm nothing is broken.
when_to_use: After editing code, refactoring, fixing bugs, or making any non-trivial change. Call this skill to validate the change works before reporting completion.
---

# Verify Skill

Run verification steps appropriate to the project to confirm the change works correctly.

## Process

1. **Detect project type** — check `package.json`, `Cargo.toml`, `pyproject.toml`, `CMakeLists.txt`, etc.
2. **Run linter** — the project's lint command (prettier, eslint, ruff, clippy, etc.)
3. **Run type-checker** — TypeScript, mypy, pyright, etc.
4. **Run tests** — unit tests relevant to the changed code
5. **Build** — confirm the project compiles

## Verification Matrix

| Project Type | Lint | Typecheck | Test | Build |
|---|---|---|---|---|
| Node/TypeScript | `npm run lint` | `npx tsc --noEmit` | `npm test` | `npm run build` |
| Python | `ruff check .` | `mypy .` | `pytest` | — |
| Rust | `cargo clippy` | — | `cargo test` | `cargo build` |
| Go | `golangci-lint run` | — | `go test ./...` | `go build ./...` |

## Rules

- Run in CWD first; if no project config found, search parent directories
- If a step fails, report the error clearly with the command that was run and the output
- Don't skip steps — even if the change is "obviously correct"
- If no test/tooling exists in the project, suggest the user add it
