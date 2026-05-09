#!/usr/bin/env bash
set -euo pipefail

LABEL="com.biz.star-atlas-stack"

if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "[ok] launchd service is loaded: $LABEL"
  launchctl print "gui/$(id -u)/$LABEL" | sed -n '1,80p'
else
  echo "[warn] launchd service is not loaded: $LABEL"
  exit 1
fi
