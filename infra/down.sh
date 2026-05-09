#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

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
	echo "[warn] docker CLI not found, nothing to stop"
	exit 0
fi

docker compose --env-file .env -f docker-compose.yml down
