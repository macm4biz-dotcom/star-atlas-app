#!/usr/bin/env bash
set -euo pipefail

LABEL="com.biz.star-atlas-stack"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INFRA_DIR="$PROJECT_DIR/infra"
PLIST_TEMPLATE="$SCRIPT_DIR/star-atlas-stack.plist.template"
AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$AGENTS_DIR/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/star-atlas-app"

if [[ ! -x "$INFRA_DIR/up.sh" ]]; then
  echo "[error] infra/up.sh is missing or not executable: $INFRA_DIR/up.sh"
  exit 1
fi

mkdir -p "$AGENTS_DIR"
mkdir -p "$LOG_DIR"

LOG_OUT="$LOG_DIR/launchd.stdout.log"
LOG_ERR="$LOG_DIR/launchd.stderr.log"

sed \
  -e "s|__LABEL__|$LABEL|g" \
  -e "s|__INFRA_DIR__|$INFRA_DIR|g" \
  -e "s|__LOG_OUT__|$LOG_OUT|g" \
  -e "s|__LOG_ERR__|$LOG_ERR|g" \
  "$PLIST_TEMPLATE" > "$PLIST_PATH"

if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)/$LABEL" || true
fi

launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl enable "gui/$(id -u)/$LABEL"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

echo "[ok] launchd service installed and started: $LABEL"
echo "[ok] plist: $PLIST_PATH"
echo "[ok] logs: $LOG_DIR"
echo "[info] if the service exits, inspect logs and ensure Docker Desktop is running"
