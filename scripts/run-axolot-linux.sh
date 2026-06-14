#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
LAUNCH_DIR="$(pwd)"

command -v bun >/dev/null 2>&1 || {
  echo "[axolot] No se encontro 'bun' en PATH." >&2
  exit 1
}

command -v openclaw >/dev/null 2>&1 || {
  echo "[axolot] No se encontro 'openclaw' en PATH." >&2
  exit 1
}

usage() {
  cat <<'EOF'
Uso:
  axolot                         Inicia Axolot usando la config actual de OpenClaw
  axolot --models                Lista modelos disponibles en OpenClaw
  axolot --model <modelo>        Cambia el modelo default de OpenClaw e inicia Axolot
  axolot --use <proveedor> <modelo>
                                  Usa un proveedor/modelo y arranca Axolot
  axolot --login [proveedor]     Inicia sesion/OAuth para un proveedor
  axolot --key <proveedor>       Pega y guarda API key para un proveedor
  axolot --auth                  Abre el asistente de autenticacion de modelos
  axolot --setup                 Abre el onboarding completo de OpenClaw
  axolot --status                Muestra estado de OpenClaw
  axolot --doctor                Ejecuta diagnostico de OpenClaw

Ejemplos:
  axolot --model openai/gpt-5.5
  axolot --use openai gpt-5.5
  axolot --use anthropic claude-sonnet-4-5
  axolot --use google gemini-2.5-pro
  axolot --login openai-codex
  axolot --key openrouter
  axolot --model openai-codex/gpt-5.5
  axolot --model ollama/qwen2.5-coder:7b
EOF
}

normalize_model_provider() {
  local provider
  provider="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$provider" in
    chatgpt|gpt|openai)
      echo "openai"
      ;;
    claude|anthropic)
      echo "anthropic"
      ;;
    gemini|google)
      echo "google"
      ;;
    *)
      echo "$provider"
      ;;
  esac
}

normalize_login_provider() {
  local provider
  provider="$(normalize_model_provider "$1")"
  case "$provider" in
    google)
      echo "google-gemini-cli"
      ;;
    *)
      echo "$provider"
      ;;
  esac
}

normalize_api_key_provider() {
  normalize_model_provider "$1"
}

model_ref_for_provider() {
  local provider="$1"
  local model="$2"
  if [[ "$model" == */* ]]; then
    echo "$model"
  else
    echo "$(normalize_model_provider "$provider")/$model"
  fi
}

openclaw_config_get() {
  local key="$1"
  bun -e 'const fs = require("fs"); const key = process.argv[1]; const path = `${process.env.HOME}/.openclaw/openclaw.json`; try { const cfg = JSON.parse(fs.readFileSync(path, "utf8")); const value = key.split(".").reduce((acc, part) => acc?.[part], cfg); if (value !== undefined && value !== null && typeof value !== "object") console.log(value); } catch {}' "$key"
}

read_openclaw_token() {
  bun -e 'const fs = require("fs"); const path = `${process.env.HOME}/.openclaw/openclaw.json`; try { const cfg = JSON.parse(fs.readFileSync(path, "utf8")); const token = cfg?.gateway?.auth?.token; if (typeof token === "string" && token.length) console.log(token); } catch {}'
}

openclaw_primary_model() {
  local model
  model="$(openclaw_config_get 'agents.defaults.model.primary')"
  if [[ -n "$model" ]]; then
    echo "$model"
    return 0
  fi
}

AXOLOT_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --models)
      exec openclaw models list
      ;;
    --auth)
      exec openclaw models auth add
      ;;
    --login)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        exec openclaw models auth add
      fi
      exec openclaw models auth login --provider "$(normalize_login_provider "$2")" --set-default
      ;;
    --login=*)
      LOGIN_PROVIDER="${1#--login=}"
      if [[ -z "$LOGIN_PROVIDER" ]]; then
        exec openclaw models auth add
      fi
      exec openclaw models auth login --provider "$(normalize_login_provider "$LOGIN_PROVIDER")" --set-default
      ;;
    --key)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        echo "[axolot] Falta el proveedor. Ejemplo: axolot --key openrouter" >&2
        exit 1
      fi
      exec openclaw models auth paste-api-key --provider "$(normalize_api_key_provider "$2")"
      ;;
    --key=*)
      KEY_PROVIDER="${1#--key=}"
      if [[ -z "$KEY_PROVIDER" ]]; then
        echo "[axolot] Falta el proveedor. Ejemplo: axolot --key=openrouter" >&2
        exit 1
      fi
      exec openclaw models auth paste-api-key --provider "$(normalize_api_key_provider "$KEY_PROVIDER")"
      ;;
    --setup)
      exec openclaw onboard --wizard
      ;;
    --status)
      exec openclaw status
      ;;
    --doctor)
      exec openclaw doctor
      ;;
    --model)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        echo "[axolot] Falta el modelo. Ejemplo: axolot --model openai/gpt-5.5" >&2
        exit 1
      fi
      echo "[axolot] Configurando modelo OpenClaw: $2"
      openclaw models set "$2"
      export UPSTREAM_MODEL="$2"
      shift 2
      ;;
    --model=*)
      MODEL_VALUE="${1#--model=}"
      if [[ -z "$MODEL_VALUE" ]]; then
        echo "[axolot] Falta el modelo. Ejemplo: axolot --model=openai/gpt-5.5" >&2
        exit 1
      fi
      echo "[axolot] Configurando modelo OpenClaw: $MODEL_VALUE"
      openclaw models set "$MODEL_VALUE"
      export UPSTREAM_MODEL="$MODEL_VALUE"
      shift
      ;;
    --use)
      if [[ $# -lt 3 || -z "${2:-}" || -z "${3:-}" ]]; then
        echo "[axolot] Falta proveedor/modelo. Ejemplo: axolot --use openai gpt-5.5" >&2
        exit 1
      fi
      MODEL_VALUE="$(model_ref_for_provider "$2" "$3")"
      echo "[axolot] Configurando proveedor/modelo OpenClaw: $MODEL_VALUE"
      openclaw models set "$MODEL_VALUE"
      export UPSTREAM_MODEL="$MODEL_VALUE"
      shift 3
      ;;
    *)
      AXOLOT_ARGS+=("$1")
      shift
      ;;
  esac
done

is_port_listening() {
  local port="$1"
  bun -e 'const port = Number(process.argv[1]); const socket = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data() {}, close() {}, error() {} } }).catch(() => null); if (socket) { socket.end(); process.exit(0); } process.exit(1);' "$port"
}

find_free_port() {
  local port
  for port in 8787 8788 8878 18887; do
    if ! is_port_listening "$port"; then
      echo "$port"
      return 0
    fi
  done

  bun -e 'const s = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } }); console.log(s.port); s.stop(true);'
}

extract_gateway_port() {
  local url="$1"
  bun -e 'const raw = process.argv[1]; try { const u = new URL(raw); const local = new Set(["127.0.0.1", "localhost", "::1"]); if (local.has(u.hostname)) console.log(u.port || (u.protocol === "https:" ? "443" : "80")); } catch {}' "$url"
}

mkdir -p "$REPO_ROOT/.axolot_tmp/run" "$REPO_ROOT/.axolot_tmp/logs"

OPENCLAW_GATEWAY_PORT="$(openclaw_config_get 'gateway.port')"
if [[ ! "$OPENCLAW_GATEWAY_PORT" =~ ^[0-9]+$ ]]; then
  OPENCLAW_GATEWAY_PORT="18789"
fi

OPENCLAW_MODEL="$(openclaw_primary_model)"
if [[ -z "$OPENCLAW_MODEL" ]]; then
  echo "[axolot] OpenClaw no tiene modelo configurado. Ejecutando setup interactivo..."
  exec openclaw onboard --wizard
fi

export UPSTREAM_URL="${UPSTREAM_URL:-http://127.0.0.1:$OPENCLAW_GATEWAY_PORT}"
export UPSTREAM_MODEL="${UPSTREAM_MODEL:-$OPENCLAW_MODEL}"
export UPSTREAM_PROVIDER="${UPSTREAM_PROVIDER:-}"
export UPSTREAM_AUTH="${UPSTREAM_AUTH:-$(read_openclaw_token)}"
export UPSTREAM_AUTH_HEADER="${UPSTREAM_AUTH_HEADER:-authorization}"
export AXOLOT_UPSTREAM_LOCAL_ONLY="${AXOLOT_UPSTREAM_LOCAL_ONLY:-1}"
export AXOLOT_OLLAMA_DIRECT="${AXOLOT_OLLAMA_DIRECT:-1}"
export AXOLOT_OPENCLAW_MODE=1
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
export AXOLOT_SKILLS_PACK="${AXOLOT_SKILLS_PACK:-token-lean}"
export CLAUDE_CONFIG_DIR="$REPO_ROOT/.axolot_tmp"
export AXOLOT_PROXY_LOG="$REPO_ROOT/.axolot_tmp/logs/proxy-output.log"

SKILLS_PACK_DIR="$REPO_ROOT/skillpacks/$AXOLOT_SKILLS_PACK"
if [[ ! -d "$SKILLS_PACK_DIR/.claude/skills" ]]; then
  SKILLS_PACK_DIR="$REPO_ROOT/skillpacks/token-lean"
fi

export CLAUDE_CODE_WORKSPACE_HOST_PATHS="$REPO_ROOT|$REPO_ROOT/src|$LAUNCH_DIR|$SKILLS_PACK_DIR|$HOME/.openclaw/workspace"
export CLAUDE_CODE_TRUSTED_ROOT="$LAUNCH_DIR"

wait_for_port() {
  local port="$1"
  local tries="${2:-20}"
  local i
  for ((i = 0; i < tries; i++)); do
    if is_port_listening "$port"; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

kill_repo_proxies() {
  local pid
  local cwd
  for pid in $(pgrep -f 'bun run src/tools/openclaw-proxy.ts' 2>/dev/null || true); do
    cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    if [[ "$cwd" == "$REPO_ROOT" ]]; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}

GATEWAY_PORT="$(extract_gateway_port "$UPSTREAM_URL")"
if [[ -n "$GATEWAY_PORT" ]]; then
  if ! is_port_listening "$GATEWAY_PORT"; then
    echo "[axolot] Iniciando OpenClaw gateway en 127.0.0.1:$GATEWAY_PORT"
    (cd "$REPO_ROOT" && openclaw gateway run --port "$GATEWAY_PORT" --ws-log compact >"$REPO_ROOT/.axolot_tmp/logs/openclaw-gateway.log" 2>&1 & echo $! >"$REPO_ROOT/.axolot_tmp/run/gateway.pid")
    wait_for_port "$GATEWAY_PORT" 30 || true
  else
    echo "[axolot] OpenClaw gateway ya escucha en puerto $GATEWAY_PORT"
  fi
fi

if [[ -f "$REPO_ROOT/.axolot_tmp/run/proxy.pid" ]]; then
  OLD_PROXY_PID="$(cat "$REPO_ROOT/.axolot_tmp/run/proxy.pid" 2>/dev/null || true)"
  if [[ "$OLD_PROXY_PID" =~ ^[0-9]+$ ]] && kill -0 "$OLD_PROXY_PID" 2>/dev/null; then
    kill "$OLD_PROXY_PID" 2>/dev/null || true
  fi
fi
kill_repo_proxies

export PROXY_PORT="${PROXY_PORT:-8787}"
if is_port_listening "$PROXY_PORT"; then
  export PROXY_PORT="$(find_free_port)"
fi

echo "[axolot] Iniciando proxy en 127.0.0.1:$PROXY_PORT"
(cd "$REPO_ROOT" && bun run src/tools/openclaw-proxy.ts >"$REPO_ROOT/.axolot_tmp/logs/proxy.log" 2>&1 & echo $! >"$REPO_ROOT/.axolot_tmp/run/proxy.pid")
wait_for_port "$PROXY_PORT" 30 || true

export ANTHROPIC_API_URL="http://127.0.0.1:$PROXY_PORT"
export ANTHROPIC_BASE_URL="$ANTHROPIC_API_URL"
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-dummy}"
export ANTHROPIC_MODEL="openclaw"
export CLAUDE_CODE_SKIP_BOOTSTRAP=0
export CLAUDE_CODE_OFFLINE_MODE=1
export CLAUDE_CODE_DISABLE_RIPGREP=1
export CLAUDE_CODE_ASSUME_TTY=1

ARGS=("${AXOLOT_ARGS[@]}")
HAS_BUDGET=0
for arg in "${ARGS[@]}"; do
  if [[ "$arg" == "--max-budget-usd" || "$arg" == --max-budget-usd=* ]]; then
    HAS_BUDGET=1
    break
  fi
done

if [[ "$HAS_BUDGET" == "0" ]]; then
  ARGS+=(--max-budget-usd "${AXOLOT_MAX_BUDGET_USD:-2}")
fi

cd "$REPO_ROOT"
exec bun run src/dev-entry.ts \
  --dangerously-skip-permissions \
  --allow-dangerously-skip-permissions \
  --permission-mode bypassPermissions \
  --add-dir "$LAUNCH_DIR" \
  --add-dir "$REPO_ROOT" \
  --add-dir "$REPO_ROOT/src" \
  --add-dir "$SKILLS_PACK_DIR" \
  --settings "$REPO_ROOT/.axolot_tmp/settings.json" \
  "${ARGS[@]}"
