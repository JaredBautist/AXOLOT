# MEMORY.md — Long-Term Memory

## ⚠️ Regla Fundamental: TUI Design es OFF-LIMITS
**NUNCA** modificar el ARTE/LAYOUT de la TUI sin autorización explícita:
- `AxolotASCIILogo.tsx` — el ajolote rosa es sagrado, no tocar
- `CondensedLogo.tsx`, `WelcomeV2.tsx`, `LogoV2.tsx` — arte/layout visual, no editar sin permiso
- Cualquier cambio de layout/arte/colores requiere orden directa del usuario

### ✅ Excepción autorizada (24-jul-2026): rebrand de TEXTO "Claude Code" → "Axolot"
El usuario autorizó cambiar los LITERALES VISIBLES de la TUI de "Claude Code"/"Claude"
a "Axolot". Esto es distinto del arte/layout. Al hacerlo, cambiar SOLO texto visible;
NO tocar: tokens de color `claude`, env vars `ANTHROPIC_*`/`CLAUDE_CODE_*`, IDs de
modelo, provider keys, nombres de tipo/variable (`ClaudeCodeStats`, `loginWithClaudeAi`),
ni prompts internos de tools/bridge/remote (infra de Anthropic o romperían la app).
Dejar sin renombrar lo atado a servicios Anthropic cloud (review "on the web",
stickers, thinkback year-in-review) — renombrarlos engañaría.

## Proyecto: Axolot CLI
- Fork de Claude Code rebrandeado como Axolot
- Publicado en npm como `axolot-ai`
- GitHub: `JaredBautist/AXOLOT` (SSH key `JaredBautist`)
- CLI entry: `src/direct/chat.js` (Node.js, no Bun)
- Version lifecycle: `0.1.6` → `0.2.1`

## Arquitectura Clave
- Circuit breaker y OutputGuard son dos capas independientes de protección anti-loop
- MiniMax M3 requiere `messagesToMiniMaxChat()` (tool results apareados con tool calls) — error 2013 si no
- Post-sampling hooks son no-bloqueantes (nunca interrumpen el flujo)
- `assertMinVersion()` deshabilitado para Axolot
- `fetchWithRetry` requiere parámetro `url` obligatorio

## Providers
- Claude, OpenAI, DeepSeek, Gemini, MiniMax — todos beneficiados por igual de cambios en prompts
- DeepSeek thinking configurable via `DEEPSEEK_THINKING` env var
- MiniMax keepalive: false en todas las peticiones fetch
- Gemini transient errors: RESOURCE_EXHAUSTED, UNAVAILABLE, DEADLINE_EXCEEDED, INTERNAL

## Smart Defaults
- `AXOLOT_AUTO_NATIVE=1` activa auto-selección de provider nativo
- `AXOLOT_BUDGET_MODE` = cost/speed/balanced/quality
- `profileProject()` detecta lenguaje y tipo de proyecto automáticamente

## Lecciones Aprendidas (24 Jun 2026)

### TUI: Lo que SÍ se puede hacer
El usuario QUIERE el ajolote rosado (`AxolotASCIILogo.tsx`) en lugar del cangrejo Clawd + "Claude Code". Lo que NO quiere:
- Layout completo con feeds, release notes, onboarding (lento)
- Dos mascotas visibles al mismo tiempo
- Cambios no autorizados al branding/arte ASCII

### Cómo implementar cambios en LogoV2.tsx
- **Early return condensado** (línea 180): es rápido, solo renderiza `CondensedLogo`/`AxolotASCIILogo` + notices
- **Layout completo** (después de línea 250): renderiza todo, es lento
- Para mostrar el ajolote: cambiar `t11 = <CondensedLogo />` → `t11 = <AxolotASCIILogo />`
- No olvidar remover el import de `CondensedLogo` si queda sin usar (error tsc)

### Flujo de trabajo con este usuario
- Preguntar ANTES de hacer cualquier cambio visual
- Si dice "déjalo como estaba", revertir al commit original, no al último cambio mío
- No force-push si ya se publicó a npm (no se puede publicar misma versión dos veces)
- Usar `npm version patch --no-git-tag-version` y commit nuevo en vez de amend

### Versiones
- `0.2.9` es la versión estable actual: TUI con ajolote, rápido, sin Clawd
