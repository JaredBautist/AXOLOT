@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
powershell -NoLogo -ExecutionPolicy Bypass -File "%SCRIPT_DIR%run-claude-full.ps1" %*
endlocal
