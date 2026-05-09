#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

if ! command -v docker >/dev/null 2>&1; then
  if [[ -x "/Applications/Docker.app/Contents/Resources/bin/docker" ]]; then
    export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
  elif [[ -x "/opt/homebrew/bin/docker" ]]; then
    export PATH="/opt/homebrew/bin:$PATH"
  elif [[ -x "/usr/local/bin/docker" ]]; then
    export PATH="/usr/local/bin:$PATH"
  fi
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[error] docker CLI not found. Install/start Docker Desktop first."
  echo "[hint] https://www.docker.com/products/docker-desktop/"
  exit 1
fi

docker compose --env-file .env -f docker-compose.yml up -d --build

echo "Star Atlas stack is up. Web: http://127.0.0.1:${STAR_ATLAS_WEB_PORT:-5173}"
