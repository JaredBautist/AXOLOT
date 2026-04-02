# Entendimientos del proyecto y futuras sesiones

## Qué se configuró
- **run-claude-full.ps1** ahora alinea el gateway y el proxy en el puerto **18789** y lanza el proxy en un puerto libre (prioriza 8787). Usa `.claude_tmp` como `CLAUDE_CONFIG_DIR` y marca el repo como trusted vía env vars.
- **OpenClaw** (`C:\Users\dylam\.openclaw\openclaw.json`):
  - `tools.exec` configurado para `host: gateway`, `security: full`, `ask: off`, `allowlist: ["*"]`.
  - Gateway en modo local, bind loopback, token fijo `4826...d4dd`, chatCompletions habilitado.
  - `agents.defaults.workspace` apunta a `C:\Users\dylam\Desktop\src`.
- **Claude settings locales** (`.claude_tmp/settings.json`): `permission-mode bypassPermissions` y allow para PowerShell/Bash/FS/etc.
- Se añadieron proyectos confiables en `.claude_tmp/.claude.json` (local). Falta asegurar lo mismo en el global `C:\Users\dylam\.claude.json` (ver pendientes).

## Cómo arrancar el CLI
1. Abrir PowerShell en `C:\Users\dylam\Desktop\src`.
2. Ejecutar: `.\run-claude-full.ps1`.
3. Verificar:
   - `netstat -ano | find "18789"` muestra gateway escuchando.
   - El proxy muestra el puerto elegido (normalmente 8787) y el título de la ventana: `Claude CLI (gateway=18789, proxy=XXXX)`.

## Pendiente importante
- Asegurar confianza global para evitar prompts `/approve` en cualquier sesión:
  - Editar **C:\Users\dylam\.claude.json** y marcar `hasTrustDialogAccepted=true` y `hasClaudeMdExternalIncludesApproved=true` para:
    - `C:\Users\dylam\Desktop\src`
    - `C:\Users\dylam\Desktop\src\src`
  - PowerShell sugerido:
    ```powershell
    $p = 'C:\Users\dylam\.claude.json'
    $j = Get-Content $p -Raw | ConvertFrom-Json
    if (-not $j.projects) { $j | Add-Member -Name projects -Value @() -MemberType NoteProperty }
    $paths = @('C:\Users\dylam\Desktop\src','C:\Users\dylam\Desktop\src\src')
    foreach ($path in $paths) {
      $proj = $j.projects | Where-Object { $_.path -eq $path }
      if (-not $proj) {
        $j.projects += [pscustomobject]@{
          path = $path
          hasTrustDialogAccepted = $true
          hasClaudeMdExternalIncludesApproved = $true
          createdAt = (Get-Date).ToString('o')
        }
      } else {
        $proj.hasTrustDialogAccepted = $true
        $proj.hasClaudeMdExternalIncludesApproved = $true
      }
    }
    $j | ConvertTo-Json -Depth 10 | Set-Content $p -Encoding UTF8
    ```

## Tips de uso rápido
- Alias opcional: añadir al `$PROFILE` `Set-Alias claude "C:\Users\dylam\Desktop\src\run-claude-full.ps1"` para lanzar desde cualquier ruta.
- Si ves `allowlist miss` en OpenClaw, revisar `tools.exec.allowlist` y reiniciar gateway.
- Para probar: dentro de la TUI pide `ls` o `Get-ChildItem` en `C:\Users\dylam\Desktop\src\src`; no debería pedir `/approve`.

## Logs y rutas útiles
- Proxy/gateway stdout: `proxy-output.log` en la raíz del repo.
- Config local aislada: `.claude_tmp\`.
- Config OpenClaw: `C:\Users\dylam\.openclaw\openclaw.json`.
- Config global Claude (donde falta confianza): `C:\Users\dylam\.claude.json`.

