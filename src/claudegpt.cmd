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
if "%UPSTREAM_AUTH%"=="" set "UPSTREAM_AUTH=4826b470842264d01279842f13bb7d4e31270b59ab3224dd"

REM Start proxy in a minimized window
start "" /min cmd /c "cd /d %ROOT% && set PROXY_PORT=%PROXY_PORT% && set UPSTREAM_URL=%UPSTREAM_URL% && set UPSTREAM_CHAT_PATH=%UPSTREAM_CHAT_PATH% && set UPSTREAM_MODEL=%UPSTREAM_MODEL% && set UPSTREAM_AUTH=%UPSTREAM_AUTH% && node tools\\claudegpt-proxy.cjs"

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
