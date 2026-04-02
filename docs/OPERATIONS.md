# Operacion y mantenimiento

## Arranque estandar

```powershell
claudex
```

Esto inicia los servicios necesarios y abre la TUI.

Si quieres usar un perfil:

```powershell
$env:CLAUDEX_PROFILE='openai'
claudex
```

Si quieres cambiar pack de skills:

```powershell
$env:CLAUDEX_SKILLS_PACK='engineering-pro'   # o token-lean
claudex
```

## Arranque manual por etapas

Cuando se requiere depuracion fina:

1. Gateway:

```powershell
openclaw gateway run --port 18789 --ws-log compact
```

2. Proxy:

```powershell
$env:PROXY_PORT='8787'
$env:UPSTREAM_URL='http://127.0.0.1:18789'
$env:UPSTREAM_MODEL='openclaw'
$env:UPSTREAM_AUTH='<token>'
$env:UPSTREAM_AUTH_HEADER='authorization'   # o 'x-api-key'
$env:CLAUDEX_UPSTREAM_LOCAL_ONLY='1'        # default recomendado
bun run src/tools/openclaw-proxy.ts
```

3. TUI:

```powershell
$env:ANTHROPIC_API_URL='http://127.0.0.1:8787'
$env:ANTHROPIC_BASE_URL=$env:ANTHROPIC_API_URL
$env:ANTHROPIC_API_KEY='dummy'
bun run src/dev-entry.ts --dangerously-skip-permissions --permission-mode bypassPermissions
```

## Verificaciones de salud

- Ver listeners:

```powershell
netstat -ano | findstr 18789
netstat -ano | findstr 8787
```

- Ver proceso:

```powershell
Get-Process | Where-Object { $_.ProcessName -like '*bun*' -or $_.ProcessName -like '*node*' }
```

- Ver logs:

```powershell
Get-Content .\.claude_tmp\logs\proxy-output.log -Tail 80
```

## Ciclo de release sugerido

1. `bun run typecheck`
2. `bun run build`
3. `bun run smoke:scripts`
4. Smoke test manual con `claudex`.
5. Confirmar docs actualizadas.
6. Commit con mensaje claro.
7. Tag de version (opcional).
8. Push a rama principal.

Nota: `bun run typecheck:full` y `bun run build:full` quedan para auditorias
del arbol completo heredado del upstream.

## Variables operativas recomendadas

- `UPSTREAM_MODEL`: permitir override por session.
- `UPSTREAM_CHAT_PATH`: ruta custom para proveedores con path no estandar.
- `UPSTREAM_AUTH`: inyectar por secreto local, no hardcode productivo.
- `UPSTREAM_AUTH_HEADER`: elegir esquema segun gateway (`authorization` o `x-api-key`).
- `PROXY_PORT`: fijar solo si se integra con tooling externo.
- `CLAUDEX_UPSTREAM_LOCAL_ONLY=1`: evita exfiltracion accidental de tokens.
- `CLAUDEX_MAX_BUDGET_USD`: limita gasto por sesion sin pasar flags en cada ejecucion.
- `CLAUDEX_PROFILE`: selecciona perfil de `.claudexrc`.
- `CLAUDEX_CONFIG`: ruta explicita del archivo de config.
- `CLAUDEX_SKILLS_PACK`: pack de skills preconfiguradas (`token-lean`/`engineering-pro`).

## Perfiles por proyecto

1. Copiar plantilla:

```powershell
Copy-Item .\.claudexrc.example.json .\.claudexrc.json
```

2. Editar perfiles/modelos.
3. Elegir perfil con `CLAUDEX_PROFILE`.

Regla de precedencia:

`env vars > perfil .claudexrc > defaults`.

## Packs de skills

- `token-lean`: pack recomendado cuando prioridad es ahorrar tokens.
- `engineering-pro`: pack más amplio para tareas especializadas.

Ambos se cargan automáticamente con `--add-dir` desde `skillpacks/<pack>/.claude/skills`.

## Control de gasto

- Ad-hoc por sesion:

```powershell
claudex --max-budget-usd 2
```

- Politica local por entorno:

```powershell
$env:CLAUDEX_MAX_BUDGET_USD='2'
claudex
```

## Limpieza de artefactos locales

No versionar:

- `.claude_tmp/`
- `.openclaw/`
- `.claude_tmp/logs/proxy-output.log`
- archivos temporales de editor

## Recuperacion rapida

Si el entorno queda inconsistente:

1. Cerrar procesos `bun/openclaw`.
2. Borrar solo artefactos temporales (`.claude_tmp`, logs).
3. Reabrir terminal.
4. Ejecutar `claudex` nuevamente.
