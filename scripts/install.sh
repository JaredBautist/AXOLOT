#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="${AXOLOT_NPM_PACKAGE:-axolot-ai}"
GITHUB_PACKAGE="${AXOLOT_GITHUB_PACKAGE:-github:JaredBautist/AXOLOT}"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm no esta instalado. Instala Node.js 20+ y vuelve a intentar." >&2
  exit 1
fi

if npm view "$PACKAGE_NAME" version >/dev/null 2>&1; then
  npm install -g "$PACKAGE_NAME"
else
  npm install -g "$GITHUB_PACKAGE"
fi

axolot --version
echo "Axolot instalado. Ejecuta: axolot"
