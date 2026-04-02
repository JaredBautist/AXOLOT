$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Get-NormalizedPath {
  param([Parameter(Mandatory = $true)][string]$PathValue)
  return ([System.IO.Path]::GetFullPath($PathValue.Trim().Trim('"'))).TrimEnd('\')
}

function Add-UserPathEntry {
  param(
    [Parameter(Mandatory = $true)][string]$Entry,
    [Parameter(Mandatory = $true)][ref]$CurrentParts,
    [Parameter(Mandatory = $true)][ref]$Known
  )

  if (-not (Test-Path -LiteralPath $Entry)) {
    return $false
  }

  $normalized = Get-NormalizedPath -PathValue $Entry
  if ($Known.Value.Contains($normalized)) {
    return $false
  }

  $Known.Value.Add($normalized) | Out-Null
  $CurrentParts.Value.Add($Entry)
  return $true
}

$repoRoot = Get-NormalizedPath -PathValue $repoRoot
$launcherPath = Join-Path $repoRoot 'claudex.cmd'
if (-not (Test-Path -LiteralPath $launcherPath)) {
  throw "No se encontro claudex.cmd en $repoRoot"
}

$npmBinDir = Join-Path $env:APPDATA 'npm'
if (-not (Test-Path -LiteralPath $npmBinDir)) {
  New-Item -ItemType Directory -Path $npmBinDir | Out-Null
}

$shimPath = Join-Path $npmBinDir 'claudex.cmd'
$shimContent = @"
@echo off
setlocal
call "$launcherPath" %*
endlocal
"@
Set-Content -LiteralPath $shimPath -Value $shimContent -Encoding ASCII

$windowsAppsDir = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps'
$windowsAppsShimPath = Join-Path $windowsAppsDir 'claudex.cmd'
$windowsAppsShimCreated = $false
if (Test-Path -LiteralPath $windowsAppsDir) {
  try {
    Set-Content -LiteralPath $windowsAppsShimPath -Value $shimContent -Encoding ASCII
    $windowsAppsShimCreated = $true
  } catch {
    Write-Host '[install] Aviso: no se pudo crear shim en WindowsApps:' $_.Exception.Message
  }
}

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$pathParts = New-Object 'System.Collections.Generic.List[string]'
if (-not [string]::IsNullOrWhiteSpace($userPath)) {
  foreach ($segment in ($userPath -split ';')) {
    if (-not [string]::IsNullOrWhiteSpace($segment)) {
      $pathParts.Add($segment.Trim())
    }
  }
}

$knownPaths = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
foreach ($segment in $pathParts) {
  try {
    $knownPaths.Add((Get-NormalizedPath -PathValue $segment)) | Out-Null
  } catch {
    # Ignore malformed entries; keep PATH maintenance resilient.
  }
}

$added = @()
if (Add-UserPathEntry -Entry $repoRoot -CurrentParts ([ref]$pathParts) -Known ([ref]$knownPaths)) {
  $added += $repoRoot
}
if (Add-UserPathEntry -Entry $npmBinDir -CurrentParts ([ref]$pathParts) -Known ([ref]$knownPaths)) {
  $added += $npmBinDir
}
$bunBinDir = Join-Path $env:USERPROFILE '.bun\bin'
if (Add-UserPathEntry -Entry $bunBinDir -CurrentParts ([ref]$pathParts) -Known ([ref]$knownPaths)) {
  $added += $bunBinDir
}

$newUserPath = ($pathParts | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join ';'
try {
  [Environment]::SetEnvironmentVariable('Path', $newUserPath, 'User')
  $env:Path = "$newUserPath;$( [Environment]::GetEnvironmentVariable('Path', 'Machine') )"
} catch {
  Write-Host '[install] Aviso: no se pudo actualizar PATH de usuario automaticamente:' $_.Exception.Message
}

Write-Host '[install] claudex shim creado en:' $shimPath
if ($windowsAppsShimCreated) {
  Write-Host '[install] claudex shim creado en:' $windowsAppsShimPath
}
if ($added.Count -gt 0) {
  Write-Host '[install] Entradas agregadas al PATH de usuario:'
  foreach ($item in $added) {
    Write-Host "  - $item"
  }
} else {
  Write-Host '[install] No se agregaron entradas nuevas al PATH (ya estaban configuradas).'
}
Write-Host '[install] Cierra y abre una terminal nueva para garantizar que "claudex" se detecte en todas las sesiones.'
