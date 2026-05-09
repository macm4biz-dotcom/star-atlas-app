#!/usr/bin/env bash
set -euo pipefail

LABEL="com.biz.star-atlas-stack"

if ! launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "[error] launchd service is not installed: $LABEL"
  exit 1
fi

launchctl kickstart -k "gui/$(id -u)/$LABEL"

echo "[ok] launchd service restarted: $LABEL"
