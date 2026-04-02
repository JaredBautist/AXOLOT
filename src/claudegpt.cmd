@echo off
REM Launch Claude Code TUI using OpenClaw (OpenAI/Codex) via local proxy.
REM You can override any of these env vars before calling, e.g.:
REM   set UPSTREAM_AUTH=sk-xxx && claudegpt

setlocal
set "ROOT=%~dp0"
set "PKG_ROOT=%ROOT%.."

set "PROXY_PORT=%PROXY_PORT%"
if "%PROXY_PORT%"=="" set "PROXY_PORT=8787"

set "UPSTREAM_URL=%UPSTREAM_URL%"
if "%UPSTREAM_URL%"=="" set "UPSTREAM_URL=http://127.0.0.1:18789"

set "UPSTREAM_CHAT_PATH=%UPSTREAM_CHAT_PATH%"
if "%UPSTREAM_CHAT_PATH%"=="" set "UPSTREAM_CHAT_PATH=/v1/chat/completions"

set "UPSTREAM_MODEL=%UPSTREAM_MODEL%"
if "%UPSTREAM_MODEL%"=="" set "UPSTREAM_MODEL=gpt-5.4"

set "UPSTREAM_AUTH=%UPSTREAM_AUTH%"
if "%UPSTREAM_AUTH%"=="" (
  echo [claudegpt] WARNING: UPSTREAM_AUTH no definido. Si el gateway exige auth, configura la variable antes de ejecutar.
)

REM Start proxy in a minimized window (single canonical proxy implementation)
start "" /min cmd /c "cd /d %PKG_ROOT% && set PROXY_PORT=%PROXY_PORT% && set UPSTREAM_URL=%UPSTREAM_URL% && set UPSTREAM_CHAT_PATH=%UPSTREAM_CHAT_PATH% && set UPSTREAM_MODEL=%UPSTREAM_MODEL% && set UPSTREAM_AUTH=%UPSTREAM_AUTH% && set CLAUDEX_PROXY_LOG=%PKG_ROOT%\\.claude_tmp\\logs\\proxy-output.log && \"%AppData%\\npm\\bun.cmd\" run src/tools/openclaw-proxy.ts"

REM Point TUI to the proxy
set "ANTHROPIC_API_URL=http://127.0.0.1:%PROXY_PORT%"
set "ANTHROPIC_BASE_URL=%ANTHROPIC_API_URL%"
if "%ANTHROPIC_API_KEY%"=="" set "ANTHROPIC_API_KEY=dummy"

cd /d %PKG_ROOT%
set "CLAUDE_RUN_LOG=%PKG_ROOT%\\claudegpt-run.log"
echo [claudegpt] starting TUI... (log: %CLAUDE_RUN_LOG%)
"%AppData%\\npm\\bun.cmd" run src/main.tsx -- --verbose > "%CLAUDE_RUN_LOG%" 2>&1
if errorlevel 1 (
  echo [claudegpt] bun exited with error. Log follows:
  type "%CLAUDE_RUN_LOG%"
  pause
)

endlocal
