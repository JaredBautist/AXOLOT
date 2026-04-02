$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Definition)

function Resolve-CommandPath {
  param(
    [Parameter(Mandatory = $true)][string[]]$Candidates,
    [Parameter(Mandatory = $true)][string]$DisplayName
  )

  foreach ($candidate in $Candidates) {
    $command = Get-Command $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) {
      return $command.Source
    }
  }

  throw "[scripts] No se encontro '$DisplayName' en PATH. Instala la herramienta o agrega su ruta al PATH."
}

# Buscar un puerto libre para el proxy (evita conflictos con otros servicios)
function Get-FreePort {
  param([int[]] $Candidates)

  foreach ($port in $Candidates) {
    if (-not (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)) {
      return $port
    }
  }

  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = $listener.LocalEndpoint.Port
  $listener.Stop()
  return $port
}

$bunPath = Resolve-CommandPath -Candidates @('bun.cmd', 'bun') -DisplayName 'bun'
$openclawPath = Resolve-CommandPath -Candidates @('openclaw.cmd', 'openclaw') -DisplayName 'openclaw'

Write-Host '[scripts] Limpiando procesos bun...'
Get-Process bun -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force }

# Aislamiento
$env:CLAUDE_CONFIG_DIR = "$PSScriptRoot\.claude_tmp"
if (!(Test-Path $env:CLAUDE_CONFIG_DIR)) {
  New-Item -ItemType Directory -Path $env:CLAUDE_CONFIG_DIR | Out-Null
}

# Variables del Proxy (elige un puerto disponible empezando en 8787)
$desiredPorts = @(8787, 8788, 8878, 18887)
$env:PROXY_PORT = (Get-FreePort -Candidates $desiredPorts).ToString()
$env:UPSTREAM_URL = 'http://127.0.0.1:18789'
$env:UPSTREAM_MODEL = 'openclaw'
$env:UPSTREAM_AUTH = '4826b470842264d01279842f13bb7d4e31270b59ab3224dd'

# Fuerza workspace confiable y accesible
$workspaceHostPaths = "$PSScriptRoot|$PSScriptRoot\src|$env:USERPROFILE\.openclaw\workspace"
$env:CLAUDE_CODE_WORKSPACE_HOST_PATHS = $workspaceHostPaths
$env:CLAUDE_CODE_TRUSTED_ROOT = $PSScriptRoot

Write-Host '[scripts] Iniciando Gateway OpenClaw (si no esta activo)...'
$gwListening = Get-NetTCPConnection -State Listen -LocalPort 18789 -ErrorAction SilentlyContinue
if (-not $gwListening) {
  $gwProc = Start-Process -FilePath $openclawPath `
    -ArgumentList @('gateway', 'run', '--port', '18789', '--ws-log', 'compact') `
    -WindowStyle Normal `
    -PassThru
  Write-Host "         GATEWAY_PID    = $($gwProc.Id)"
  Start-Sleep -Seconds 2
} else {
  Write-Host '         GATEWAY        = ya estaba escuchando en 18789'
}

Write-Host '[scripts] Iniciando Proxy con Entorno Corregido...'
Write-Host "         PROXY_PORT     = $($env:PROXY_PORT)"
Write-Host "         UPSTREAM_URL   = $($env:UPSTREAM_URL)"
Write-Host "         UPSTREAM_MODEL = $($env:UPSTREAM_MODEL)"

# Lanzar proxy en segundo plano para no bloquear el CLI
$proxyProc = Start-Process -FilePath $bunPath `
  -ArgumentList @('run', 'src/tools/openclaw-proxy.ts') `
  -WorkingDirectory $PSScriptRoot `
  -NoNewWindow `
  -PassThru
Write-Host "         PROXY_PID      = $($proxyProc.Id)"

# Esperar un poco a que abra el puerto
Start-Sleep -Seconds 2

# Variables para Claude CLI
$env:ANTHROPIC_API_URL = "http://127.0.0.1:$($env:PROXY_PORT)"
$env:ANTHROPIC_BASE_URL = $env:ANTHROPIC_API_URL
$env:ANTHROPIC_API_KEY = 'sk-ant-dummy-key-123'
$env:CLAUDE_CODE_SKIP_BOOTSTRAP = '0'
$env:CLAUDE_CODE_OFFLINE_MODE = '1'
$env:CLAUDE_CODE_DISABLE_RIPGREP = '1'
$env:CLAUDE_CODE_ASSUME_TTY = '1'

Write-Host '[scripts] Lanzando el asistente (ventana aparte para TTY real)...'
$bunCliPath = $bunPath.Replace("'", "''")
$workspaceHostPathsEscaped = $workspaceHostPaths.Replace("'", "''")
$trustedRootEscaped = $PSScriptRoot.Replace("'", "''")
$claudeConfigDirEscaped = $env:CLAUDE_CONFIG_DIR.Replace("'", "''")
$homeDrive = [System.IO.Path]::GetPathRoot($env:CLAUDE_CONFIG_DIR).TrimEnd('\\')
$homePath = $env:CLAUDE_CONFIG_DIR.Substring($homeDrive.Length)
$homeDriveEscaped = $homeDrive.Replace("'", "''")
$homePathEscaped = $homePath.Replace("'", "''")

$cliCmd = @"
`$env:ANTHROPIC_API_URL='$($env:ANTHROPIC_API_URL)';
`$env:ANTHROPIC_BASE_URL='$($env:ANTHROPIC_BASE_URL)';
`$env:ANTHROPIC_API_KEY='$($env:ANTHROPIC_API_KEY)';
`$env:CLAUDE_CODE_SKIP_BOOTSTRAP='0';
`$env:CLAUDE_CODE_OFFLINE_MODE='1';
`$env:CLAUDE_CODE_DISABLE_RIPGREP='1';
`$env:CLAUDE_CODE_ASSUME_TTY='1';
`$env:CLAUDE_CONFIG_DIR='$claudeConfigDirEscaped';
`$env:CLAUDE_CODE_WORKSPACE_HOST_PATHS='$workspaceHostPathsEscaped';
`$env:CLAUDE_CODE_TRUSTED_ROOT='$trustedRootEscaped';
`$env:USERPROFILE='$claudeConfigDirEscaped';
`$env:HOMEDRIVE='$homeDriveEscaped';
`$env:HOMEPATH='$homePathEscaped';
`$env:HOME='$claudeConfigDirEscaped';
Set-Location '$trustedRootEscaped';
`$host.UI.RawUI.WindowTitle = 'Claude CLI (gateway=18789, proxy=$($env:PROXY_PORT))';
`$ProgressPreference='SilentlyContinue';
& '$bunCliPath' run src/dev-entry.ts --dangerously-skip-permissions --allow-dangerously-skip-permissions --permission-mode bypassPermissions --add-dir '$trustedRootEscaped' --add-dir '$trustedRootEscaped\\src' --settings '$trustedRootEscaped\\.claude_tmp\\settings.json'
"@

Start-Process -FilePath powershell -ArgumentList '-NoExit', '-Command', $cliCmd -WindowStyle Normal -PassThru | Out-Null
