# MEMORY.md — Long-Term Memory

## ⚠️ Regla Fundamental: TUI Design es OFF-LIMITS
**NUNCA** modificar componentes de TUI branding sin autorización explícita:
- `AxolotASCIILogo.tsx` — el ajolote rosa es sagrado, no tocar
- `CondensedLogo.tsx`, `WelcomeV2.tsx`, `LogoV2.tsx` — branding visual, no editar sin permiso
- Cualquier cambio visual en la interfaz requiere orden directa del usuario

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
