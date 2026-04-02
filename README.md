# Claudex CLI (Claude Code + OpenClaw + Codex 5.4)

Claudex es un fork operativo del CLI de Claude Code para correr en modo local con backend OpenClaw y modelo Codex (`gpt-5.4`), sin depender del endpoint oficial de Anthropic.

## Tabla de contenido

- [Vision](#vision)
- [Arquitectura](#arquitectura)
- [Requisitos](#requisitos)
- [Compatibilidad de modelos y cuentas](#compatibilidad-de-modelos-y-cuentas)
- [Instalacion](#instalacion)
- [Uso diario](#uso-diario)
- [Configuracion](#configuracion)
- [Scripts principales](#scripts-principales)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Flujo de desarrollo](#flujo-de-desarrollo)
- [Troubleshooting](#troubleshooting)
- [Seguridad y buenas practicas](#seguridad-y-buenas-practicas)
- [Plan para una herramienta lista](#plan-para-una-herramienta-lista)

## Vision

Objetivo del proyecto:

1. Reusar la interfaz TUI de Claude Code.
2. Reemplazar el backend por OpenClaw (gateway local).
3. Enrutar mensajes Anthropic-style hacia OpenAI-compatible responses.
4. Lanzar todo con un solo comando global: `claudex`.

Resultado: un flujo de trabajo de programacion asistida desde terminal, local-first, reproducible y portable.

## Arquitectura

```text
Usuario -> claudex.cmd -> scripts/run-claude-full.ps1
                           |-> openclaw gateway run (puerto 18789)
                           |-> bun run src/tools/openclaw-proxy.ts (puerto libre, default 8787)
                           `-> bun run src/dev-entry.ts (TUI)

TUI (Anthropic API shape)
  -> Proxy OpenClaw (traduce payload y stream)
    -> OpenClaw Gateway (/v1/chat/completions)
      -> Modelo Codex 5.4
```

Documentacion tecnica extendida:

- `docs/ARCHITECTURE.md`
- `docs/OPERATIONS.md`
- `docs/TROUBLESHOOTING.md`

## Requisitos

- Windows 10/11 con PowerShell.
- `bun` en PATH.
- `openclaw` en PATH.
- Node/Bun dependencies instaladas (`bun install`).
- OpenClaw configurado y con acceso al modelo destino.
- Para el flujo recomendado con Codex/OpenAI: cuenta de ChatGPT Plus o acceso API equivalente configurado en OpenClaw.

## Compatibilidad de modelos y cuentas

- Claudex queda abierto para cualquier modelo que OpenClaw pueda enrutar.
- Hoy el setup base esta enfocado en `gpt-5.4`, pero no esta amarrado a un solo proveedor.
- Puedes usar otros proveedores/modelos segun tu cuenta y configuracion en OpenClaw, por ejemplo:
  - OpenAI/Codex
  - Gemini
  - Grok
  - Kimi
  - Ollama (local)
- En la practica, el requisito real depende del backend que configures: cuenta del proveedor o modelo local.

## Instalacion

1. Instalar dependencias:

```powershell
bun install
```

2. Instalar launcher global `claudex`:

```powershell
powershell -NoLogo -ExecutionPolicy Bypass -File .\scripts\install-claudex.ps1
```

Alternativa:

```powershell
bun run install:claudex
```

3. Cerrar y abrir terminal nueva.

4. Verificar:

```powershell
Get-Command claudex
```

5. (Opcional) definir variables en tu entorno usando `.env.example` como referencia, especialmente `UPSTREAM_AUTH` si tu gateway exige autenticacion.

## Uso diario

Desde cualquier carpeta:

```powershell
claudex
```

Con limite de gasto por sesion (recomendado):

```powershell
claudex --max-budget-usd 2
```

Que hace automaticamente:

- Levanta OpenClaw gateway en `127.0.0.1:18789` si no estaba activo.
- Levanta proxy local en un puerto libre (prioridad `8787`, `8788`, `8878`, `18887`).
- Configura `ANTHROPIC_API_URL` hacia el proxy local.
- Abre la TUI en nueva ventana con TTY real.

## Configuracion

Variables importantes del launcher:

- `PROXY_PORT`: puerto del proxy.
- `UPSTREAM_URL`: endpoint del gateway OpenClaw.
- `UPSTREAM_MODEL`: modelo enviado al upstream.
- `UPSTREAM_AUTH`: token de autenticacion hacia upstream.
- `UPSTREAM_AUTH_HEADER`: header para token (`authorization` por defecto, o `x-api-key`).
- `CLAUDEX_UPSTREAM_LOCAL_ONLY`: `1` por defecto para bloquear upstream remoto y evitar fuga accidental de token.
- `CLAUDEX_MAX_BUDGET_USD`: presupuesto maximo por sesion (inyecta `--max-budget-usd` si no se pasa manualmente).
- `CLAUDE_CONFIG_DIR`: carpeta aislada de configuracion local (`.claude_tmp`).

La resolucion de `bun` y `openclaw` se hace por PATH en runtime, con error explicito si falta alguna herramienta.

## Scripts principales

- `claudex.cmd`: entrypoint corto.
- `scripts/run-claude-full.ps1`: orquestador completo (gateway + proxy + TUI).
- `scripts/install-claudex.ps1`: instalacion del comando global.
- `src/tools/openclaw-proxy.ts`: traductor Anthropic <-> OpenAI Chat Completions.
- `src/tools/ollama-cli.ts`: utilidad CLI para probar Ollama directo.

NPM/Bun scripts:

- `bun run dev`
- `bun run build`
- `bun run build:full`
- `bun run start`
- `bun run start:full`
- `bun run typecheck`
- `bun run typecheck:full`
- `bun run smoke:scripts`
- `bun run openclaw-proxy`
- `bun run install:claudex`

## Estructura del proyecto

```text
.
|-- claudex.cmd
|-- scripts/
|   |-- run-claude-full.ps1
|   `-- install-claudex.ps1
|-- src/
|   |-- dev-entry.ts
|   `-- tools/
|       |-- openclaw-proxy.ts
|       `-- ollama-cli.ts
|-- docs/
|   |-- ARCHITECTURE.md
|   |-- OPERATIONS.md
|   `-- TROUBLESHOOTING.md
|-- workspace/
|   |-- SOUL.md
|   |-- USER.md
|   |-- HEARTBEAT.md
|   `-- TOOLS.md
`-- README.md
```

## Flujo de desarrollo

1. Cambiar codigo en `src/`.
2. Validar tipos:

```powershell
bun run typecheck
```

Para validar el arbol completo heredado del upstream (puede fallar mientras se reduce deuda tecnica):

```powershell
bun run typecheck:full
```

3. Probar launcher:

```powershell
claudex
```

4. Revisar logs:

```powershell
Get-Content .\.claude_tmp\logs\proxy-output.log -Tail 80
```

## Validacion automatica

Este repo incluye CI en GitHub Actions (`.github/workflows/ci.yml`) con:

- `bun run typecheck`
- `bun run build`
- `bun run smoke:scripts`

## Troubleshooting

Guia completa: `docs/TROUBLESHOOTING.md`.

Casos comunes:

- `bun` no encontrado -> instalar Bun y abrir terminal nueva.
- `openclaw` no encontrado -> instalar CLI de OpenClaw y validar PATH.
- Puerto ocupado -> launcher selecciona puerto alternativo automaticamente.
- Proxy responde 401/403 -> revisar `UPSTREAM_AUTH`.
- TUI no abre -> ejecutar `scripts/run-claude-full.ps1` manualmente para ver errores directos.

## Seguridad y buenas practicas

- No subir secretos reales al repositorio.
- Evitar hardcodear tokens productivos.
- No commitear logs de ejecucion.
- Mantener `.gitignore` actualizado para artefactos locales.
- Revisar permisos de herramientas externas antes de usar bypass total.
- Revisar y respetar `LICENSE` antes de redistribuir el codigo.
- Claudex ahora bloquea upstream remoto por defecto (`CLAUDEX_UPSTREAM_LOCAL_ONLY=1`).
- El token `UPSTREAM_AUTH` se usa solo en el proxy y no se reinyecta a la TUI.
- El proxy redacta secretos en logs para reducir riesgo de fuga.
- Usa presupuesto por sesion: `claudex --max-budget-usd 2` o `CLAUDEX_MAX_BUDGET_USD=2`.

## Plan para una herramienta lista

1. **Base estable (listo)**: launcher global, hardening de secretos, CI minima y estructura ordenada inicial.
2. **Confiabilidad (en progreso)**: proxy canonico unificado, sin kill global de `bun`, control de procesos por PID del proxy.
3. **Seguridad/costos (en progreso)**: upstream local-only por defecto, redaccion de secretos en logs y limite de presupuesto por sesion.
4. **Producto multi-modelo (siguiente)**: selector de backend/modelo por config/flags (`OpenAI`, `Gemini`, `Grok`, `Kimi`, `Ollama`).
5. **Calidad operativa (siguiente)**: tests de contrato del proxy, smoke tests E2E y logs estructurados.
6. **Release serio (siguiente)**: versionado, changelog, docs de despliegue y empaquetado multiplataforma.
