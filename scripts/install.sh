#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="${CLAUDEX_NPM_PACKAGE:-claudex-ai}"
GITHUB_PACKAGE="${CLAUDEX_GITHUB_PACKAGE:-github:JaredBautist/CLAUDEX}"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm no esta instalado. Instala Node.js 20+ y vuelve a intentar." >&2
  exit 1
fi

if npm view "$PACKAGE_NAME" version >/dev/null 2>&1; then
  npm install -g "$PACKAGE_NAME"
else
  npm install -g "$GITHUB_PACKAGE"
fi

claudex --version
echo "Claudex instalado. Ejecuta: claudex"
