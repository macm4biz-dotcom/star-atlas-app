#!/usr/bin/env bash
set -euo pipefail

WEB_URL="${STAR_ATLAS_WEB_URL:-http://127.0.0.1:5173}"
API_HEALTH_URL="${STAR_ATLAS_API_HEALTH_URL:-http://127.0.0.1:5173/health}"
INTEL_URL="${STAR_ATLAS_INTEL_URL:-http://127.0.0.1:5173/api/intel/overview?limit=3}"

check_url() {
  local name="$1"
  local url="$2"
  local code

  code=$(curl -s -o /dev/null -w "%{http_code}" "$url" || true)
  if [[ "$code" == "200" ]]; then
    echo "[ok] $name: $url (HTTP $code)"
  else
    echo "[warn] $name: $url (HTTP ${code:-n/a})"
  fi
}

check_url "web" "$WEB_URL"
check_url "api-health" "$API_HEALTH_URL"
check_url "intel" "$INTEL_URL"
