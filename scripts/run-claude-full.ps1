param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$CliArgs
)

$ErrorActionPreference = 'Stop'
$launchDir = (Get-Location).Path
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

function Has-Value {
  param([object]$Value)

  if ($null -eq $Value) { return $false }
  if ($Value -is [string]) { return $Value.Trim().Length -gt 0 }
  return $true
}

function Get-ObjectProperty {
  param(
    [object]$Object,
    [string]$Name
  )

  if ($null -eq $Object) { return $null }
  $prop = $Object.PSObject.Properties[$Name]
  if ($null -eq $prop) { return $null }
  return $prop.Value
}

function Resolve-ClaudexConfigPath {
  param(
    [string]$LaunchDir,
    [string]$RepoRoot,
    [string]$ConfigHint
  )

  $candidates = @()
  if (Has-Value $ConfigHint) {
    if ([System.IO.Path]::IsPathRooted($ConfigHint)) {
      $candidates += $ConfigHint
    } else {
      $candidates += (Join-Path $LaunchDir $ConfigHint)
      $candidates += (Join-Path $RepoRoot $ConfigHint)
    }
  }

  $candidates += @(
    (Join-Path $LaunchDir '.claudexrc.json'),
    (Join-Path $LaunchDir '.claudexrc'),
    (Join-Path $RepoRoot '.claudexrc.json'),
    (Join-Path $RepoRoot '.claudexrc')
  )

  foreach ($candidate in $candidates | Select-Object -Unique) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  return $null
}

function Load-ClaudexConfig {
  param([string]$ConfigPath)

  if (-not (Has-Value $ConfigPath)) { return $null }

  $raw = Get-Content -LiteralPath $ConfigPath -Raw
  if (-not (Has-Value $raw)) { return $null }

  try {
    return $raw | ConvertFrom-Json -Depth 20
  } catch {
    throw "[scripts] No se pudo parsear config '$ConfigPath'. Usa JSON valido."
  }
}

function Resolve-ConfigSetting {
  param(
    [string]$EnvName,
    [object]$ProfileConfig,
    [object]$RootConfig,
    [string[]]$Keys,
    [object]$DefaultValue = $null
  )

  $envValue = [Environment]::GetEnvironmentVariable($EnvName)
  if (Has-Value $envValue) { return $envValue }

  foreach ($key in $Keys) {
    $value = Get-ObjectProperty -Object $ProfileConfig -Name $key
    if (Has-Value $value) { return $value }
  }

  foreach ($key in $Keys) {
    $value = Get-ObjectProperty -Object $RootConfig -Name $key
    if (Has-Value $value) { return $value }
  }

  return $DefaultValue
}

function To-FlagString {
  param(
    [object]$Value,
    [string]$DefaultValue = '1'
  )

  if ($null -eq $Value) { return $DefaultValue }
  if ($Value -is [bool]) {
    if ($Value) { return '1' }
    return '0'
  }

  $normalized = "$Value".Trim().ToLowerInvariant()
  if ($normalized -in @('1', 'true', 'yes', 'on')) { return '1' }
  if ($normalized -in @('0', 'false', 'no', 'off')) { return '0' }
  return $DefaultValue
}

# Buscar un puerto libre para el proxy (evita conflictos con otros servicios)
function Get-FreePort {
  param([int[]]$Candidates)

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

  if (!(Test-Path -LiteralPath $PidFile)) {
    return
  }

  $rawPid = (Get-Content -LiteralPath $PidFile -Raw).Trim()
  $pidValue = 0
  if ([int]::TryParse($rawPid, [ref]$pidValue)) {
    $existing = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if ($existing) {
      Write-Host "[scripts] Cerrando proceso previo $Label (PID=$pidValue)..."
      Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
    }
  }

  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

function Get-LocalGatewayPort {
  param([string]$UpstreamUrl)

  if (-not (Has-Value $UpstreamUrl)) { return $null }

  $uri = $null
  try {
    $uri = [System.Uri]$UpstreamUrl
  } catch {
    return $null
  }

  if ($uri.Scheme -notin @('http', 'https')) { return $null }
  if ($uri.AbsolutePath -and $uri.AbsolutePath -ne '/') { return $null }

  $upstreamHost = $uri.Host.ToLowerInvariant()
  if ($upstreamHost -notin @('127.0.0.1', 'localhost', '::1')) { return $null }

  if ($uri.IsDefaultPort) { return 18789 }
  return $uri.Port
}

$configPath = Resolve-ClaudexConfigPath -LaunchDir $launchDir -RepoRoot $repoRoot -ConfigHint $env:CLAUDEX_CONFIG
$claudexConfig = Load-ClaudexConfig -ConfigPath $configPath
if (Has-Value $configPath) {
  Write-Host "[scripts] Config detectada: $configPath"
}

$profileName = [Environment]::GetEnvironmentVariable('CLAUDEX_PROFILE')
if (-not (Has-Value $profileName)) {
  $profileName = Get-ObjectProperty -Object $claudexConfig -Name 'defaultProfile'
}
if (-not (Has-Value $profileName)) {
  $profileName = Get-ObjectProperty -Object $claudexConfig -Name 'provider'
}

$profileConfig = $null
$profiles = Get-ObjectProperty -Object $claudexConfig -Name 'profiles'
if (Has-Value $profileName -and $null -ne $profiles) {
  $profileConfig = Get-ObjectProperty -Object $profiles -Name $profileName
  if ($null -eq $profileConfig) {
    throw "[scripts] Perfil '$profileName' no existe en la seccion profiles del archivo .claudexrc."
  }
}

$upstreamUrl = Resolve-ConfigSetting -EnvName 'UPSTREAM_URL' -ProfileConfig $profileConfig -RootConfig $claudexConfig -Keys @('upstreamUrl', 'upstream_url', 'url') -DefaultValue 'http://127.0.0.1:18789'
$upstreamModel = Resolve-ConfigSetting -EnvName 'UPSTREAM_MODEL' -ProfileConfig $profileConfig -RootConfig $claudexConfig -Keys @('model', 'upstreamModel', 'upstream_model') -DefaultValue 'openclaw'
$upstreamChatPath = Resolve-ConfigSetting -EnvName 'UPSTREAM_CHAT_PATH' -ProfileConfig $profileConfig -RootConfig $claudexConfig -Keys @('chatPath', 'upstreamChatPath', 'upstream_chat_path') -DefaultValue ''
$upstreamAuthHeader = Resolve-ConfigSetting -EnvName 'UPSTREAM_AUTH_HEADER' -ProfileConfig $profileConfig -RootConfig $claudexConfig -Keys @('authHeader', 'upstreamAuthHeader', 'upstream_auth_header') -DefaultValue 'authorization'
$localOnlyRaw = Resolve-ConfigSetting -EnvName 'CLAUDEX_UPSTREAM_LOCAL_ONLY' -ProfileConfig $profileConfig -RootConfig $claudexConfig -Keys @('localOnly', 'upstreamLocalOnly') -DefaultValue '1'
$maxBudgetRaw = Resolve-ConfigSetting -EnvName 'CLAUDEX_MAX_BUDGET_USD' -ProfileConfig $profileConfig -RootConfig $claudexConfig -Keys @('maxBudgetUsd', 'max_budget_usd') -DefaultValue $null
$proxyPortRaw = Resolve-ConfigSetting -EnvName 'PROXY_PORT' -ProfileConfig $profileConfig -RootConfig $claudexConfig -Keys @('proxyPort', 'proxy_port') -DefaultValue $null
$skillsPackRaw = Resolve-ConfigSetting -EnvName 'CLAUDEX_SKILLS_PACK' -ProfileConfig $profileConfig -RootConfig $claudexConfig -Keys @('skillsPack', 'skills_pack') -DefaultValue 'token-lean'

$env:UPSTREAM_URL = "$upstreamUrl"
$env:UPSTREAM_MODEL = "$upstreamModel"
$env:UPSTREAM_AUTH_HEADER = "$upstreamAuthHeader"
$env:CLAUDEX_UPSTREAM_LOCAL_ONLY = (To-FlagString -Value $localOnlyRaw -DefaultValue '1')
$env:CLAUDEX_SKILLS_PACK = "$skillsPackRaw"
if (Has-Value $upstreamChatPath) {
  $env:UPSTREAM_CHAT_PATH = "$upstreamChatPath"
}
if (-not (Has-Value [Environment]::GetEnvironmentVariable('CLAUDEX_MAX_BUDGET_USD')) -and (Has-Value $maxBudgetRaw)) {
  $env:CLAUDEX_MAX_BUDGET_USD = "$maxBudgetRaw"
}

$desiredPorts = @(8787, 8788, 8878, 18887)
if (Has-Value $proxyPortRaw) {
  $parsedProxyPort = 0
  if (-not [int]::TryParse("$proxyPortRaw", [ref]$parsedProxyPort) -or $parsedProxyPort -lt 1 -or $parsedProxyPort -gt 65535) {
    throw "[scripts] PROXY_PORT invalido: '$proxyPortRaw'. Usa un entero entre 1 y 65535."
  }
  $env:PROXY_PORT = "$parsedProxyPort"
} else {
  $env:PROXY_PORT = (Get-FreePort -Candidates $desiredPorts).ToString()
}

$bunPath = Resolve-CommandPath -Candidates @('bun.cmd', 'bun') -DisplayName 'bun'

# Aislamiento
$env:CLAUDE_CONFIG_DIR = "$repoRoot\.claude_tmp"
if (!(Test-Path -LiteralPath $env:CLAUDE_CONFIG_DIR)) {
  New-Item -ItemType Directory -Path $env:CLAUDE_CONFIG_DIR | Out-Null
}
$runDir = Join-Path $env:CLAUDE_CONFIG_DIR 'run'
if (!(Test-Path -LiteralPath $runDir)) {
  New-Item -ItemType Directory -Path $runDir | Out-Null
}
$proxyPidFile = Join-Path $runDir 'proxy.pid'

if (-not $env:UPSTREAM_AUTH) {
  Write-Host '[scripts] Aviso: UPSTREAM_AUTH no esta definido. Si tu gateway requiere token, exportalo antes de ejecutar claudex.'
}

$selectedSkillsPackName = if (Has-Value $env:CLAUDEX_SKILLS_PACK) { $env:CLAUDEX_SKILLS_PACK } else { 'token-lean' }
$selectedSkillsPackDir = $null
$packDirCandidate = Join-Path $repoRoot "skillpacks\$selectedSkillsPackName"
$packSkillsDirCandidate = Join-Path $packDirCandidate '.claude\skills'
if (Test-Path -LiteralPath $packSkillsDirCandidate -PathType Container) {
  $selectedSkillsPackDir = $packDirCandidate
} else {
  $fallbackPackName = 'token-lean'
  $fallbackPackDir = Join-Path $repoRoot "skillpacks\$fallbackPackName"
  $fallbackPackSkillsDir = Join-Path $fallbackPackDir '.claude\skills'
  if ($selectedSkillsPackName -ne $fallbackPackName -and (Test-Path -LiteralPath $fallbackPackSkillsDir -PathType Container)) {
    Write-Host "[scripts] Skills pack '$selectedSkillsPackName' no existe. Usando fallback '$fallbackPackName'."
    $selectedSkillsPackName = $fallbackPackName
    $selectedSkillsPackDir = $fallbackPackDir
  } else {
    Write-Host "[scripts] Skills pack '$selectedSkillsPackName' no encontrado. Continuando sin pack de skills."
  }
}
$env:CLAUDEX_SKILLS_PACK = $selectedSkillsPackName

# Fuerza workspace confiable y accesible
$workspaceHostEntries = @(
  $repoRoot,
  "$repoRoot\src",
  $launchDir,
  $selectedSkillsPackDir,
  "$env:USERPROFILE\.openclaw\workspace"
) | Where-Object { Has-Value $_ } | Select-Object -Unique
$workspaceHostPaths = ($workspaceHostEntries -join '|')
$env:CLAUDE_CODE_WORKSPACE_HOST_PATHS = $workspaceHostPaths
$env:CLAUDE_CODE_TRUSTED_ROOT = $launchDir

$gatewayPort = Get-LocalGatewayPort -UpstreamUrl $env:UPSTREAM_URL
if ($null -ne $gatewayPort) {
  $openclawPath = Resolve-CommandPath -Candidates @('openclaw.cmd', 'openclaw') -DisplayName 'openclaw'
  Write-Host "[scripts] Iniciando Gateway OpenClaw en puerto $gatewayPort (si no esta activo)..."
  $gwListening = Get-NetTCPConnection -State Listen -LocalPort $gatewayPort -ErrorAction SilentlyContinue
  if (-not $gwListening) {
    $gwProc = Start-Process -FilePath $openclawPath `
      -ArgumentList @('gateway', 'run', '--port', "$gatewayPort", '--ws-log', 'compact') `
      -WindowStyle Normal `
      -PassThru
    Write-Host "         GATEWAY_PID    = $($gwProc.Id)"
    Start-Sleep -Seconds 2
  } else {
    Write-Host "         GATEWAY        = ya estaba escuchando en $gatewayPort"
  }
} else {
  Write-Host '[scripts] Gateway auto-start omitido: UPSTREAM_URL no es un endpoint local base.'
}

Write-Host '[scripts] Iniciando Proxy con entorno configurado...'
Write-Host "         PROXY_PORT     = $($env:PROXY_PORT)"
Write-Host "         UPSTREAM_URL   = $($env:UPSTREAM_URL)"
Write-Host "         UPSTREAM_MODEL = $($env:UPSTREAM_MODEL)"
Write-Host "         AUTH_HEADER    = $($env:UPSTREAM_AUTH_HEADER)"
Write-Host "         LOCAL_ONLY     = $($env:CLAUDEX_UPSTREAM_LOCAL_ONLY)"
if (Has-Value $selectedSkillsPackDir) {
  Write-Host "         SKILLS_PACK    = $selectedSkillsPackName"
}
if (Has-Value $profileName) {
  Write-Host "         PROFILE        = $profileName"
}

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
$trustedRootEscaped = $launchDir.Replace("'", "''")
$repoRootEscaped = $repoRoot.Replace("'", "''")
$entryScriptEscaped = "$repoRoot\src\dev-entry.ts".Replace("'", "''")
$claudeConfigDirEscaped = $env:CLAUDE_CONFIG_DIR.Replace("'", "''")
$homeDrive = [System.IO.Path]::GetPathRoot($env:CLAUDE_CONFIG_DIR).TrimEnd('\')
$homePath = $env:CLAUDE_CONFIG_DIR.Substring($homeDrive.Length)
$homeDriveEscaped = $homeDrive.Replace("'", "''")
$homePathEscaped = $homePath.Replace("'", "''")
$escapedExtraArgs = ($forwardedCliArgs | ForEach-Object { "'$($_.Replace("'", "''"))'" }) -join ' '
$addDirsForCli = @($launchDir, $repoRoot, "$repoRoot\src")
if (Has-Value $selectedSkillsPackDir) {
  $addDirsForCli += $selectedSkillsPackDir
}
$escapedAddDirArgs = (($addDirsForCli | Select-Object -Unique) | ForEach-Object { "--add-dir '$($_.Replace("'", "''"))'" }) -join ' '
$titleGateway = if ($null -ne $gatewayPort) { $gatewayPort } else { 'externo' }

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
Set-Location '$repoRootEscaped';
`$host.UI.RawUI.WindowTitle = 'Claude CLI (gateway=$titleGateway, proxy=$($env:PROXY_PORT))';
`$ProgressPreference='SilentlyContinue';
& '$bunCliPath' run '$entryScriptEscaped' --dangerously-skip-permissions --allow-dangerously-skip-permissions --permission-mode bypassPermissions $escapedAddDirArgs --settings '$repoRootEscaped\\.claude_tmp\\settings.json' $escapedExtraArgs
"@

Start-Process -FilePath powershell -ArgumentList '-NoExit', '-Command', $cliCmd -WindowStyle Normal -PassThru | Out-Null
