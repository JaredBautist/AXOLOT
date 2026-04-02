# Guia Step by Step (Windows)

Esta guia deja Claudex listo para usar desde cualquier carpeta con `claudex`.

## 1) Requisitos

Verifica herramientas:

```powershell
Get-Command bun
Get-Command openclaw
```

Si alguno falla, instala esa herramienta y abre una nueva terminal.

## 2) Instalar dependencias del proyecto

Desde la raiz del repo:

```powershell
bun install
```

## 3) Instalar comando global `claudex`

```powershell
powershell -NoLogo -ExecutionPolicy Bypass -File .\scripts\install-claudex.ps1
```

Valida:

```powershell
Get-Command claudex
```

## 4) (Opcional) Crear config por perfiles

```powershell
Copy-Item .\.claudexrc.example.json .\.claudexrc.json
```

Perfil recomendado:

```powershell
$env:CLAUDEX_PROFILE='openai'
```

## 5) (Opcional) Elegir pack de skills

`token-lean` ahorra tokens. `engineering-pro` da mas cobertura tecnica.

```powershell
$env:CLAUDEX_SKILLS_PACK='token-lean'
```

## 6) Configurar token solo si tu gateway lo requiere

Si OpenClaw pide auth:

```powershell
$env:UPSTREAM_AUTH='tu_token'
```

Si no pide auth, no pongas nada.

## 7) Ejecutar Claudex

```powershell
claudex
```

## 8) Entender mensajes comunes al arrancar

- `Aviso: UPSTREAM_AUTH no esta definido`: normal si tu gateway no requiere token.
- `Gateway ... ya estaba escuchando`: normal, significa que ya estaba corriendo.
- `Skills pack '<x>' no existe`: revisa `CLAUDEX_SKILLS_PACK` o usa `token-lean`.

## 9) Limitar gasto por sesion (recomendado)

Directo en comando:

```powershell
claudex --max-budget-usd 2
```

O por variable:

```powershell
$env:CLAUDEX_MAX_BUDGET_USD='2'
claudex
```

## 10) Si algo falla

1. Ejecuta:

```powershell
Get-Command claudex
Get-Command bun
Get-Command openclaw
```

2. Revisa logs:

```powershell
Get-Content .\.claude_tmp\logs\proxy-output.log -Tail 80
```

3. Consulta:

- `docs/TROUBLESHOOTING.md`

