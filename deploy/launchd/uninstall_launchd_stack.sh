#!/usr/bin/env bash
set -euo pipefail

LABEL="com.biz.star-atlas-stack"
AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$AGENTS_DIR/$LABEL.plist"
PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
INFRA_DIR="$PROJECT_DIR/infra"

if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)/$LABEL" || true
fi

if [[ -f "$PLIST_PATH" ]]; then
  rm -f "$PLIST_PATH"
fi

if [[ -x "$INFRA_DIR/down.sh" ]]; then
  "$INFRA_DIR/down.sh" || true
fi

echo "[ok] launchd service removed: $LABEL"
