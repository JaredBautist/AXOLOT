# Operacion y mantenimiento

## Arranque estandar

```powershell
claudex
```

Esto inicia los servicios necesarios y abre la TUI.

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
Get-Content .\proxy-output.log -Tail 80
```

## Ciclo de release sugerido

1. `bun run typecheck`
2. Smoke test con `claudex`.
3. Confirmar docs actualizadas.
4. Commit con mensaje claro.
5. Tag de version (opcional).
6. Push a rama principal.

## Variables operativas recomendadas

- `UPSTREAM_MODEL`: permitir override por session.
- `UPSTREAM_AUTH`: inyectar por secreto local, no hardcode productivo.
- `PROXY_PORT`: fijar solo si se integra con tooling externo.

## Limpieza de artefactos locales

No versionar:

- `.claude_tmp/`
- `.openclaw/`
- `proxy-output.log`
- archivos temporales de editor

## Recuperacion rapida

Si el entorno queda inconsistente:

1. Cerrar procesos `bun/openclaw`.
2. Borrar solo artefactos temporales (`.claude_tmp`, logs).
3. Reabrir terminal.
4. Ejecutar `claudex` nuevamente.
