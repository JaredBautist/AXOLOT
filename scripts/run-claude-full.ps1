param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$CliArgs
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

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

function Stop-TrackedProcess {
  param(
    [Parameter(Mandatory = $true)][string]$PidFile,
    [Parameter(Mandatory = $true)][string]$Label
  )

  if (!(Test-Path $PidFile)) {
    return
  }

  $rawPid = (Get-Content -Raw $PidFile).Trim()
  $pidValue = 0
  if ([int]::TryParse($rawPid, [ref]$pidValue)) {
    $existing = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if ($existing) {
      Write-Host "[scripts] Cerrando proceso previo $Label (PID=$pidValue)..."
      Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
    }
  }

  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

$bunPath = Resolve-CommandPath -Candidates @('bun.cmd', 'bun') -DisplayName 'bun'
$openclawPath = Resolve-CommandPath -Candidates @('openclaw.cmd', 'openclaw') -DisplayName 'openclaw'

# Aislamiento
$env:CLAUDE_CONFIG_DIR = "$repoRoot\.claude_tmp"
if (!(Test-Path $env:CLAUDE_CONFIG_DIR)) {
  New-Item -ItemType Directory -Path $env:CLAUDE_CONFIG_DIR | Out-Null
}
$runDir = Join-Path $env:CLAUDE_CONFIG_DIR 'run'
if (!(Test-Path $runDir)) {
  New-Item -ItemType Directory -Path $runDir | Out-Null
}
$proxyPidFile = Join-Path $runDir 'proxy.pid'

# Variables del Proxy (elige un puerto disponible empezando en 8787)
$desiredPorts = @(8787, 8788, 8878, 18887)
$env:PROXY_PORT = (Get-FreePort -Candidates $desiredPorts).ToString()
$env:UPSTREAM_URL = 'http://127.0.0.1:18789'
$env:UPSTREAM_MODEL = 'openclaw'
if (-not $env:CLAUDEX_UPSTREAM_LOCAL_ONLY) {
  $env:CLAUDEX_UPSTREAM_LOCAL_ONLY = '1'
}
if (-not $env:UPSTREAM_AUTH) {
  Write-Host '[scripts] Aviso: UPSTREAM_AUTH no esta definido. Si tu gateway requiere token, exportalo antes de ejecutar claudex.'
}

# Fuerza workspace confiable y accesible
$workspaceHostPaths = "$repoRoot|$repoRoot\src|$env:USERPROFILE\.openclaw\workspace"
$env:CLAUDE_CODE_WORKSPACE_HOST_PATHS = $workspaceHostPaths
$env:CLAUDE_CODE_TRUSTED_ROOT = $repoRoot

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
Write-Host "         LOCAL_ONLY     = $($env:CLAUDEX_UPSTREAM_LOCAL_ONLY)"

Stop-TrackedProcess -PidFile $proxyPidFile -Label 'proxy'

# Lanzar proxy en segundo plano para no bloquear el CLI
$proxyProc = Start-Process -FilePath $bunPath `
  -ArgumentList @('run', 'src/tools/openclaw-proxy.ts') `
  -WorkingDirectory $repoRoot `
  -NoNewWindow `
  -PassThru
Write-Host "         PROXY_PID      = $($proxyProc.Id)"
Set-Content -LiteralPath $proxyPidFile -Value $proxyProc.Id -Encoding ascii

# Esperar un poco a que abra el puerto
Start-Sleep -Seconds 2

# Variables para Claude CLI
$env:ANTHROPIC_API_URL = "http://127.0.0.1:$($env:PROXY_PORT)"
$env:ANTHROPIC_BASE_URL = $env:ANTHROPIC_API_URL
if (-not $env:ANTHROPIC_API_KEY) {
  $env:ANTHROPIC_API_KEY = 'dummy'
}
$env:CLAUDE_CODE_SKIP_BOOTSTRAP = '0'
$env:CLAUDE_CODE_OFFLINE_MODE = '1'
$env:CLAUDE_CODE_DISABLE_RIPGREP = '1'
$env:CLAUDE_CODE_ASSUME_TTY = '1'

$forwardedCliArgs = @()
if ($CliArgs) {
  $forwardedCliArgs += $CliArgs
}
$hasBudgetFlag = $false
foreach ($arg in $forwardedCliArgs) {
  if ($arg -eq '--max-budget-usd' -or $arg -like '--max-budget-usd=*') {
    $hasBudgetFlag = $true
    break
  }
}
if ($env:CLAUDEX_MAX_BUDGET_USD -and -not $hasBudgetFlag) {
  $forwardedCliArgs += @('--max-budget-usd', $env:CLAUDEX_MAX_BUDGET_USD)
}
if ($forwardedCliArgs.Count -gt 0) {
  Write-Host "         CLAUDEX_ARGS   = $($forwardedCliArgs -join ' ')"
}

# El token solo lo necesita el proxy, no la TUI.
Remove-Item Env:UPSTREAM_AUTH -ErrorAction SilentlyContinue

Write-Host '[scripts] Lanzando el asistente (ventana aparte para TTY real)...'
$bunCliPath = $bunPath.Replace("'", "''")
$workspaceHostPathsEscaped = $workspaceHostPaths.Replace("'", "''")
$trustedRootEscaped = $repoRoot.Replace("'", "''")
$claudeConfigDirEscaped = $env:CLAUDE_CONFIG_DIR.Replace("'", "''")
$homeDrive = [System.IO.Path]::GetPathRoot($env:CLAUDE_CONFIG_DIR).TrimEnd('\\')
$homePath = $env:CLAUDE_CONFIG_DIR.Substring($homeDrive.Length)
$homeDriveEscaped = $homeDrive.Replace("'", "''")
$homePathEscaped = $homePath.Replace("'", "''")
$escapedExtraArgs = ($forwardedCliArgs | ForEach-Object { "'$($_.Replace("'", "''"))'" }) -join ' '

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
& '$bunCliPath' run src/dev-entry.ts --dangerously-skip-permissions --allow-dangerously-skip-permissions --permission-mode bypassPermissions --add-dir '$trustedRootEscaped' --add-dir '$trustedRootEscaped\\src' --settings '$trustedRootEscaped\\.claude_tmp\\settings.json' $escapedExtraArgs
"@

Start-Process -FilePath powershell -ArgumentList '-NoExit', '-Command', $cliCmd -WindowStyle Normal -PassThru | Out-Null
