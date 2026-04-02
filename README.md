# Claudex CLI (Claude Code + OpenClaw + Codex 5.4)

Claudex es un fork operativo del CLI de Claude Code para correr en modo local con backend OpenClaw y modelo Codex (`gpt-5.4`), sin depender del endpoint oficial de Anthropic.

## Tabla de contenido

- [Vision](#vision)
- [Arquitectura](#arquitectura)
- [Requisitos](#requisitos)
- [Instalacion](#instalacion)
- [Uso diario](#uso-diario)
- [Configuracion](#configuracion)
- [Scripts principales](#scripts-principales)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Flujo de desarrollo](#flujo-de-desarrollo)
- [Troubleshooting](#troubleshooting)
- [Seguridad y buenas practicas](#seguridad-y-buenas-practicas)
- [Roadmap sugerido](#roadmap-sugerido)

## Vision

Objetivo del proyecto:

1. Reusar la interfaz TUI de Claude Code.
2. Reemplazar el backend por OpenClaw (gateway local).
3. Enrutar mensajes Anthropic-style hacia OpenAI-compatible responses.
4. Lanzar todo con un solo comando global: `claudex`.

Resultado: un flujo de trabajo de programacion asistida desde terminal, local-first, reproducible y portable.

## Arquitectura

```text
Usuario -> claudex.cmd -> run-claude-full.ps1
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

## Instalacion

1. Instalar dependencias:

```powershell
bun install
```

2. Instalar launcher global `claudex`:

```powershell
powershell -NoLogo -ExecutionPolicy Bypass -File .\install-claudex.ps1
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

## Uso diario

Desde cualquier carpeta:

```powershell
claudex
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
- `CLAUDE_CONFIG_DIR`: carpeta aislada de configuracion local (`.claude_tmp`).

La resolucion de `bun` y `openclaw` se hace por PATH en runtime, con error explicito si falta alguna herramienta.

## Scripts principales

- `claudex.cmd`: entrypoint corto.
- `run-claude-full.ps1`: orquestador completo (gateway + proxy + TUI).
- `install-claudex.ps1`: instalacion del comando global.
- `src/tools/openclaw-proxy.ts`: traductor Anthropic <-> OpenAI Chat Completions.

NPM/Bun scripts:

- `bun run dev`
- `bun run build`
- `bun run start`
- `bun run typecheck`
- `bun run openclaw-proxy`
- `bun run install:claudex`

## Estructura del proyecto

```text
.
|-- claudex.cmd
|-- run-claude-full.ps1
|-- install-claudex.ps1
|-- src/
|   |-- dev-entry.ts
|   `-- tools/openclaw-proxy.ts
|-- docs/
|   |-- ARCHITECTURE.md
|   |-- OPERATIONS.md
|   `-- TROUBLESHOOTING.md
`-- README.md
```

## Flujo de desarrollo

1. Cambiar codigo en `src/`.
2. Validar tipos:

```powershell
bun run typecheck
```

3. Probar launcher:

```powershell
claudex
```

4. Revisar logs:

```powershell
Get-Content .\proxy-output.log -Tail 80
```

## Troubleshooting

Guia completa: `docs/TROUBLESHOOTING.md`.

Casos comunes:

- `bun` no encontrado -> instalar Bun y abrir terminal nueva.
- `openclaw` no encontrado -> instalar CLI de OpenClaw y validar PATH.
- Puerto ocupado -> launcher selecciona puerto alternativo automaticamente.
- Proxy responde 401/403 -> revisar `UPSTREAM_AUTH`.
- TUI no abre -> ejecutar `run-claude-full.ps1` manualmente para ver errores directos.

## Seguridad y buenas practicas

- No subir secretos reales al repositorio.
- Evitar hardcodear tokens productivos.
- No commitear logs de ejecucion.
- Mantener `.gitignore` actualizado para artefactos locales.
- Revisar permisos de herramientas externas antes de usar bypass total.

## Roadmap sugerido

1. Parametrizar modelo por argumento CLI (`claudex --model gpt-5.4`).
2. Agregar tests de contrato para el proxy.
3. Agregar observabilidad estructurada (json logs).
4. Publicar release reproducible con changelog.
5. Agregar instalador cruzado para Linux/macOS.
