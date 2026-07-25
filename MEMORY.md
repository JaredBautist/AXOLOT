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

## Prompts nativos (TUI, motor `nativeProvider.ts`)
- `nativeSystemPrompt()` = identidad + prompt estático + módulos dinámicos por tipo de tarea (`nativePromptModules.ts`)
- Los módulos dinámicos van AL FINAL para no romper el prefix-caching (el prefijo estable identity+static queda byte-idéntico entre turnos)
- **Frontend design bar INLINE**: `buildNativeFrontendPromptModule()` incrusta la guía concreta de diseño (destilada de `FRONTEND_DESIGN_PROMPT`) directamente en el system prompt. Razón: los modelos no-Claude (glm/kimi/deepseek/gemini) NO invocan skills de forma fiable, así que la barra de calidad debe venir en el prompt, no solo como puntero a la skill
- Se activa vía `shouldIncludeNativeFrontendPrompt()` (regex de keywords UI); mantiene el guard de NO tocar branding/arte TUI del propio repo
- `axolot chat` (path directo) es one-shot minimal: solo usa `--system`, no arma system prompt propio

## Permission modes / "Auto mode" (Shift+Tab)
- Ciclo externo (no-ant): default → acceptEdits → plan → **bypassPermissions** → default
- **"Auto mode" = el modo `bypassPermissions` re-etiquetado** (title 'Auto mode', shortTitle 'Auto', color 'warning') en `PermissionMode.ts`. El enum interno sigue siendo `bypassPermissions`; solo cambia la etiqueta visible → status line muestra "auto mode on"
- El `auto` real (con clasificador de riesgo) está tras `feature('TRANSCRIPT_CLASSIFIER')`, apagado para externos y atado a infra Anthropic → NO usable. Por eso se reusa bypass
- `getNextPermissionMode.ts` case 'plan': para externos (`USER_TYPE !== 'ant'`) siempre devuelve `bypassPermissions` (sin requerir `--dangerously-skip-permissions`). Funciona porque: enforcement `permissions.ts:1269` concede allow con solo `mode === 'bypassPermissions'` (sin checar `isBypassPermissionsModeAvailable`), y `transitionPermissionMode` nunca lanza al entrar a bypass (solo lanza para `toMode==='auto'`)
- NO tocar `AutoModeOptInDialog.tsx` (copy legal, atado al clasificador real)

## Providers
- Claude, OpenAI, DeepSeek, Gemini, MiniMax, GLM, Kimi, NVIDIA — todos beneficiados por igual de cambios en prompts
- DeepSeek thinking configurable via `DEEPSEEK_THINKING` env var
- MiniMax keepalive: false en todas las peticiones fetch
- Gemini transient errors: RESOURCE_EXHAUSTED, UNAVAILABLE, DEADLINE_EXCEEDED, INTERNAL

### NVIDIA NIM (GLM / Kimi / NVIDIA "your favorite model") — 24 Jul 2026
- Endpoint universal `https://integrate.api.nvidia.com/v1`: UNA nvapi- key desbloquea 100+ modelos
- `NVIDIA_HOSTED = ['glm','kimi','deepseek','nvidia']` comparten la key vía `sharedNvidiaKey()` (prefiere `NVIDIA_API_KEY`, si no cualquier sibling)
- El endpoint devuelve UN catálogo compartido para todo provider → causa raíz del bug del picker (DeepSeek mostraba los 118 modelos)
- Fix picker: filtro por keywords por provider (`PROVIDER_MODEL_KEYWORDS`) + orden newest-first (`localeCompare numeric`); glm/kimi/deepseek muestran solo lo suyo
- **Item 8 "Your favorite model"** = provider `nvidia` genérico (top-level, después de Kimi): passthrough de CUALQUIER modelo del catálogo, sin filtro de keyword (`keywords=null`)
- Defaults más recientes: GLM `z-ai/glm-5.2`, Kimi `moonshotai/kimi-k2.6` (verificados en build.nvidia.com)
- Model refs con `/` (org prefix): `setDirectModel` parte en el PRIMER `/`, preserva resto con `modelParts.join('/')`
- `getBaseUrl`: glm/kimi/nvidia default a NVIDIA_BASE_URL; DeepSeek NO (usa api.deepseek.com oficial)

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
