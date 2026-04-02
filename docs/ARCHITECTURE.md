# Arquitectura tecnica

## Objetivo

Reutilizar la experiencia CLI/TUI de Claude Code y desacoplarla del backend Anthropic para enrutar solicitudes via OpenClaw hacia Codex.

## Componentes

### 1) Launcher (`claudex.cmd`)

- Wrapper minimo en CMD.
- Delega toda la orquestacion a `run-claude-full.ps1`.
- Permite ejecucion simple desde cualquier carpeta.

### 2) Orquestador (`run-claude-full.ps1`)

Responsabilidades:

- Resolver ejecutables (`bun`, `openclaw`) desde PATH.
- Detectar/seleccionar puerto de proxy.
- Levantar OpenClaw gateway si no existe listener en `18789`.
- Levantar proxy Bun (`src/tools/openclaw-proxy.ts`).
- Exportar variables de entorno de compatibilidad Anthropic.
- Lanzar la TUI en otra ventana con TTY real.

### 3) Proxy (`src/tools/openclaw-proxy.ts`)

Responsabilidades:

- Exponer endpoint con forma Anthropic (`/v1/messages`).
- Convertir mensajes Anthropic a formato OpenAI Chat Completions.
- Reenviar al upstream OpenClaw.
- Reconvertir respuesta a stream SSE estilo Anthropic.
- Mapear tool calls entre formatos.

### 4) TUI (`src/dev-entry.ts` -> `src/main.tsx`)

- Entrypoint del cliente CLI.
- Consume endpoints Anthropic-style.
- Opera contra el proxy local.

## Flujo de datos

1. Usuario ejecuta `claudex`.
2. PowerShell inicia gateway/proxy.
3. TUI envia request a `ANTHROPIC_API_URL` (proxy local).
4. Proxy adapta payload y consulta OpenClaw.
5. OpenClaw usa backend configurado (Codex 5.4).
6. Proxy traduce respuesta y la TUI la renderiza.

## Puertos

- OpenClaw gateway: `18789` (fijo en launcher actual).
- Proxy local: puerto dinamico, preferencia `8787`, `8788`, `8878`, `18887`.

## Decisiones clave

- Mantener contrato Anthropic en frontend para minimizar cambios en TUI.
- Aislar configuracion en `.claude_tmp` para no contaminar configuracion global.
- Resolver dependencias en runtime para mayor portabilidad entre maquinas.

## Riesgos actuales

- `run-claude-full.ps1` fuerza cierre de procesos `bun`; puede afectar otras sesiones.
- Token upstream default en script; no recomendado para entornos compartidos.
- Proxy tiene varias rutas fallback; conviene testear solo rutas soportadas por la version de OpenClaw objetivo.

## Mejoras tecnicas recomendadas

1. Reemplazar `Get-Process bun | Stop-Process` por kill selectivo por puerto/PID hijo.
2. Externalizar token/modelo a `.env` local no versionado.
3. Agregar tests de regresion del adaptador de mensajes y tool calls.
4. Instrumentar proxy con logs json y niveles (`info/warn/error`).
