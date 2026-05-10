#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_PYTHON="$ROOT_DIR/backend/venv/Scripts/python.exe"
ISSUE_ADMIN_TOKEN_SCRIPT="$ROOT_DIR/backend/tests/issue_admin_token.py"
BACKEND_HEALTH_URL="${ADMIN_BASE_URL:-http://127.0.0.1:8081}"
E2E_BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:4173}"
ADMIN_EMAIL="${E2E_ADMIN_EMAIL:-${ADMIN_EMAIL:-yh@qs.al}}"
ADMIN_PASSWORD="${E2E_ADMIN_PASSWORD:-${ADMIN_PASSWORD:-}}"
ADMIN_TOKEN="${E2E_ADMIN_TOKEN:-${ADMIN_TOKEN:-}}"
E2E_CHECK_UI_LOGIN="${E2E_CHECK_UI_LOGIN:-0}"
E2E_REQUIRE_BACKEND_DEPENDENCIES="${E2E_REQUIRE_BACKEND_DEPENDENCIES:-1}"
PLAYWRIGHT_CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/graphinsight-playwright-libs"
PLAYWRIGHT_LIB_DIR="$PLAYWRIGHT_CACHE_ROOT/root/usr/lib/x86_64-linux-gnu"

wsl_health_check() {
  local url="$1"
  curl -fsS --max-time 3 "$url/health" >/dev/null 2>&1
}

health_check() {
  powershell.exe -NoProfile -Command "\
    try { \
      \$resp = Invoke-RestMethod -Method Get -Uri '$BACKEND_HEALTH_URL/health' -TimeoutSec 5; \
      if (\$resp.code -ne 200) { exit 1 }; \
      if ('$E2E_REQUIRE_BACKEND_DEPENDENCIES' -ne '1') { exit 0 }; \
      \$data = \$resp.data; \
      if (\$data -and \$data.neo4j -and \$data.neo4j.connected -eq \$true -and \$data.python_backend -and \$data.python_backend.connected -eq \$true -and \$data.orchestrator -and \$data.orchestrator.connected -eq \$true) { exit 0 } else { exit 1 } \
    } catch { exit 1 }" >/dev/null 2>&1
}

show_backend_health() {
  powershell.exe -NoProfile -Command "try { Invoke-RestMethod -Method Get -Uri '$BACKEND_HEALTH_URL/health' -TimeoutSec 5 | ConvertTo-Json -Depth 8 } catch { Write-Host \$_.Exception.Message }"
}

ensure_playwright_runtime_libs() {
  local browser_bin
  local asound_pkg

  browser_bin="$(find "$HOME/.cache/ms-playwright" -path '*/chrome-headless-shell-linux64/chrome-headless-shell' -print -quit 2>/dev/null || true)"
  if [[ -z "$browser_bin" ]]; then
    return 0
  fi

  if [[ -d "$PLAYWRIGHT_LIB_DIR" ]]; then
    export LD_LIBRARY_PATH="$PLAYWRIGHT_LIB_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  fi

  if "$browser_bin" --version >/dev/null 2>&1; then
    return 0
  fi

  if ! command -v apt >/dev/null 2>&1 || ! command -v dpkg-deb >/dev/null 2>&1; then
    return 0
  fi

  mkdir -p "$PLAYWRIGHT_CACHE_ROOT/debs" "$PLAYWRIGHT_CACHE_ROOT/root"
  if apt-cache show libasound2t64 >/dev/null 2>&1; then
    asound_pkg="libasound2t64"
  else
    asound_pkg="libasound2"
  fi

  (
    cd "$PLAYWRIGHT_CACHE_ROOT/debs"
    apt -o APT::Cmd::Disable-Script-Warning=true download libnspr4 libnss3 "$asound_pkg" >/dev/null
  )

  for deb in "$PLAYWRIGHT_CACHE_ROOT"/debs/*.deb; do
    dpkg-deb -x "$deb" "$PLAYWRIGHT_CACHE_ROOT/root"
  done

  export LD_LIBRARY_PATH="$PLAYWRIGHT_LIB_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
}

resolve_vite_api_base_url() {
  local explicit_base="${VITE_API_BASE_URL:-}"
  local backend_hostport
  local backend_port
  local windows_gateway
  local gateway_base

  if [[ -n "$explicit_base" ]]; then
    echo "$explicit_base"
    return 0
  fi

  if wsl_health_check "$BACKEND_HEALTH_URL"; then
    echo "$BACKEND_HEALTH_URL"
    return 0
  fi

  backend_hostport="${BACKEND_HEALTH_URL#http://}"
  backend_hostport="${backend_hostport#https://}"
  backend_hostport="${backend_hostport%%/*}"
  backend_port="${backend_hostport##*:}"
  if [[ "$backend_port" == "$backend_hostport" ]]; then
    backend_port="80"
  fi

  windows_gateway="$(ip route 2>/dev/null | awk '/default/ { print $3; exit }')"
  if [[ -n "$windows_gateway" ]]; then
    gateway_base="http://${windows_gateway}:${backend_port}"
    if wsl_health_check "$gateway_base"; then
      echo "$gateway_base"
      return 0
    fi
  fi

  return 1
}

resolve_admin_token() {
  local base_url="$1"
  local response

  if [[ -z "$ADMIN_PASSWORD" ]]; then
    return 1
  fi

  response="$(
    curl -fsS \
      -H 'Content-Type: application/json' \
      -d "{\"username\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
      "${base_url%/}/api/v1/admin/auth/login"
  )" || {
    echo "ADMIN_LOGIN_PREFLIGHT_FAIL base_url=$base_url email=$ADMIN_EMAIL" >&2
    return 1
  }

  python3 - <<'PY' "$response"
import json
import sys

payload = json.loads(sys.argv[1])
token = ((payload.get("data") or {}).get("token") or "").strip()
if not token:
    raise SystemExit(1)
print(token)
PY
}

resolve_local_admin_token() {
  if [[ ! -f "$BACKEND_PYTHON" || ! -f "$ISSUE_ADMIN_TOKEN_SCRIPT" ]]; then
    return 1
  fi

  "$BACKEND_PYTHON" "$ISSUE_ADMIN_TOKEN_SCRIPT" --email "$ADMIN_EMAIL" 2>/dev/null
}

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v22.* ]]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
  nvm use 22 >/dev/null
fi

if ! health_check; then
  echo "BACKEND_HEALTH_FAIL url=$BACKEND_HEALTH_URL require_dependencies=$E2E_REQUIRE_BACKEND_DEPENDENCIES"
  show_backend_health
  echo "Please start Python capability backend and Go gateway first, then rerun frontend E2E."
  exit 1
fi

cd "$FRONTEND_DIR"
ensure_playwright_runtime_libs
export ADMIN_EMAIL
export ADMIN_PASSWORD
export E2E_BASE_URL
export E2E_CHECK_UI_LOGIN
if [[ -z "${VITE_API_BASE_URL:-}" ]]; then
  if ! resolved_vite_api_base_url="$(resolve_vite_api_base_url)"; then
    echo "BACKEND_ROUTE_UNREACHABLE from_wsl=true backend_url=$BACKEND_HEALTH_URL"
    echo "WSL cannot reach the Go gateway via localhost or Windows gateway address."
    echo "Please run the gateway inside WSL, expose a reachable address, or set VITE_API_BASE_URL explicitly."
    exit 1
  fi
  export VITE_API_BASE_URL="$resolved_vite_api_base_url"
fi

if [[ -z "$ADMIN_TOKEN" && -n "$ADMIN_PASSWORD" ]]; then
  ADMIN_TOKEN="$(resolve_admin_token "$VITE_API_BASE_URL")"
fi
if [[ -z "$ADMIN_TOKEN" ]]; then
  if ADMIN_TOKEN="$(resolve_local_admin_token)"; then
    echo "ADMIN_TOKEN_READY source=local"
  fi
fi
if [[ -z "$ADMIN_TOKEN" ]]; then
  echo "Missing ADMIN_PASSWORD or ADMIN_TOKEN for frontend E2E, and local token issue failed."
  exit 1
fi
export ADMIN_TOKEN

npm run e2e
