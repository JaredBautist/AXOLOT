# Troubleshooting

## 1) `claudex` no se reconoce

### Sintoma

`Get-Command claudex` no devuelve resultado.

### Acciones

1. Ejecutar instalador:

```powershell
powershell -NoLogo -ExecutionPolicy Bypass -File .\scripts\install-claudex.ps1
```

2. Cerrar y abrir terminal.
3. Revalidar con `Get-Command claudex`.

## 2) `bun` no encontrado

### Sintoma

Error al arrancar launcher indicando que `bun` no esta en PATH.

### Acciones

1. Instalar Bun.
2. Confirmar:

```powershell
Get-Command bun
```

3. Abrir nueva terminal y reintentar.

## 3) `openclaw` no encontrado

### Sintoma

Error de launcher indicando que `openclaw` no esta en PATH.

### Acciones

1. Instalar OpenClaw CLI.
2. Confirmar:

```powershell
Get-Command openclaw
```

3. Reintentar `claudex`.

## 4) Error 401/403 en proxy

### Sintoma

`.claude_tmp/logs/proxy-output.log` muestra respuesta upstream con autorizacion fallida.

### Acciones

1. Revisar token en `UPSTREAM_AUTH`.
2. Validar que OpenClaw gateway espera el mismo esquema de auth.
3. Reiniciar launcher.

## 5) Puerto ocupado

### Sintoma

No inicia proxy o gateway por conflicto de puertos.

### Acciones

1. Revisar procesos:

```powershell
netstat -ano | findstr 18789
netstat -ano | findstr 8787
```

2. Cerrar proceso conflictivo por PID.
3. Reintentar.

Nota: el proxy ya intenta puertos alternativos automaticamente.

## 6) La TUI abre pero no responde

### Sintoma

Interfaz visible, pero requests sin respuesta.

### Acciones

1. Verificar que gateway escucha en `18789`.
2. Revisar `.claude_tmp/logs/proxy-output.log`.
3. Probar upstream manual con curl/httpie si aplica.
4. Reintentar con arranque manual por etapas (ver `docs/OPERATIONS.md`).

## 7) Permisos o trust prompts inesperados

### Sintoma

La TUI pide aprobaciones frecuentes.

### Acciones

1. Revisar `CLAUDE_CODE_WORKSPACE_HOST_PATHS`.
2. Verificar configuracion local en `.claude_tmp`.
3. Alinear politicas de permisos segun entorno de trabajo.

## Checklist minimo de diagnostico

```powershell
Get-Command claudex
Get-Command bun
Get-Command openclaw
netstat -ano | findstr 18789
Get-Content .\.claude_tmp\logs\proxy-output.log -Tail 80
```
