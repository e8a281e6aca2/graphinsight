#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
GO_BACKEND_DIR="$ROOT_DIR/go-backend"
LOG_DIR="$ROOT_DIR/logs/dev"
DEV_PYTHON_ENV_FILE="$LOG_DIR/backend.env"
RUNTIME_ENV_FILE="$LOG_DIR/runtime.env"
BACKEND_MEDIA_DIR="$BACKEND_DIR/media"
BACKEND_DOCUMENTS_DIR="$BACKEND_DIR/documents"

PYTHON_HOST="${PYTHON_HOST:-0.0.0.0}"
PYTHON_PORT="${PYTHON_PORT:-8001}"
GO_HOST="${GO_HOST:-0.0.0.0}"
GO_PORT="${GO_PORT:-8081}"
LOCAL_ACCESS_HOST="${LOCAL_ACCESS_HOST:-localhost}"
NEO4J_HTTP_PORT="${GRAPHINSIGHT_NEO4J_HTTP_PORT:-7474}"
NEO4J_BOLT_PORT="${GRAPHINSIGHT_NEO4J_BOLT_PORT:-7687}"
NEO4J_URI="${GRAPHINSIGHT_NEO4J_URI:-bolt://127.0.0.1:${NEO4J_BOLT_PORT}}"
NEO4J_USER="${GRAPHINSIGHT_NEO4J_USER:-neo4j}"
NEO4J_PASSWORD="${GRAPHINSIGHT_NEO4J_PASSWORD:-change-this-password}"
NEO4J_DATABASE="${GRAPHINSIGHT_NEO4J_DATABASE:-neo4j}"
ADMIN_DB_PORT="${GRAPHINSIGHT_ADMIN_DB_PORT:-5434}"
ADMIN_DB_NAME="${GRAPHINSIGHT_ADMIN_DB_NAME:-graphinsight_admin}"
ADMIN_DB_USER="${GRAPHINSIGHT_ADMIN_DB_USER:-graphinsight}"
ADMIN_DB_PASSWORD="${GRAPHINSIGHT_ADMIN_DB_PASSWORD:-graphinsight-dev-password}"
DEFAULT_ADMIN_DATABASE_URL="postgresql://${ADMIN_DB_USER}:${ADMIN_DB_PASSWORD}@127.0.0.1:${ADMIN_DB_PORT}/${ADMIN_DB_NAME}"
ALLOW_REMOTE_ADMIN_DB="${ALLOW_REMOTE_ADMIN_DB:-false}"
ADMIN_DATABASE_URL="${ADMIN_DATABASE_URL:-}"

mkdir -p "$LOG_DIR"

usage() {
  cat <<'USAGE'
Usage: scripts/dev-backend.sh [command]

Commands:
  up        Start Postgres, Neo4j, Python capability service, and Go gateway.
  stop      Stop Python and Go processes started by this script.
  restart   Stop then start backend services.
  status    Print local service status.
  logs      Tail Python and Go dev logs.

Environment:
  PYTHON_PORT=8001
  GO_PORT=8081
  GRAPHINSIGHT_NEO4J_HTTP_PORT=7474
  GRAPHINSIGHT_NEO4J_BOLT_PORT=7687
  GRAPHINSIGHT_NEO4J_USER=neo4j
  GRAPHINSIGHT_NEO4J_PASSWORD=change-this-password
  GRAPHINSIGHT_ADMIN_DB_PORT=5434
  GRAPHINSIGHT_ADMIN_DB_NAME=graphinsight_admin
  GRAPHINSIGHT_ADMIN_DB_USER=graphinsight
  GRAPHINSIGHT_ADMIN_DB_PASSWORD=graphinsight-dev-password
  ALLOW_REMOTE_ADMIN_DB=false
USAGE
}

command="${1:-up}"

pid_file() {
  local name="$1"
  echo "$LOG_DIR/$name.pid"
}

is_listening() {
  local port="$1"
  ss -ltn "( sport = :$port )" | tail -n +2 | grep -q .
}

access_url() {
  local port="$1"
  echo "http://$LOCAL_ACCESS_HOST:$port"
}

http_ok() {
  local url="$1"
  curl -fsS --max-time 2 "$url" >/dev/null 2>&1
}

fetch_health_body() {
  local url="$1"
  curl -fsS --max-time 2 "$url" 2>/dev/null
}

trim_wrapping_quotes() {
  local value="$1"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

read_env_value_from_file() {
  local file="$1"
  local key="$2"
  [[ -f "$file" ]] || return 1

  local line value
  line="$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n 1 || true)"
  [[ -n "$line" ]] || return 1
  value="${line#*=}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  trim_wrapping_quotes "$value"
}

resolve_admin_database_url() {
  if [[ "${ALLOW_REMOTE_ADMIN_DB,,}" == "true" && -n "${ADMIN_DATABASE_URL:-}" ]]; then
    return
  fi

  ADMIN_DATABASE_URL="$DEFAULT_ADMIN_DATABASE_URL"
}

wait_for_pg() {
  local attempts="${1:-40}"
  local i
  for ((i = 1; i <= attempts; i++)); do
    if docker compose -f "$ROOT_DIR/docker-compose.dev.yml" exec -T postgres \
      pg_isready -U "$ADMIN_DB_USER" -d "$ADMIN_DB_NAME" >/dev/null 2>&1; then
      echo "[dev-backend] Postgres is ready: 127.0.0.1:$ADMIN_DB_PORT/$ADMIN_DB_NAME"
      return
    fi
    sleep 1
  done
  echo "[dev-backend] Postgres did not become ready on 127.0.0.1:$ADMIN_DB_PORT" >&2
  return 1
}

ensure_postgres() {
  resolve_admin_database_url
  if docker compose -f "$ROOT_DIR/docker-compose.dev.yml" ps postgres 2>/dev/null | grep -q "Up"; then
    wait_for_pg 20
    return
  fi

  echo "[dev-backend] starting Postgres via docker compose"
  docker compose -f "$ROOT_DIR/docker-compose.dev.yml" up -d postgres
  wait_for_pg 60
}

is_graphinsight_python() {
  local url="$1"
  local body
  body="$(fetch_health_body "$url")" || return 1
  [[ "$body" == *'"neo4j"'* && "$body" == *'"build_tag"'* ]]
}

is_graphinsight_go() {
  local url="$1"
  local body
  body="$(fetch_health_body "$url")" || return 1
  [[ "$body" == *'"python_backend"'* && "$body" == *'"orchestrator"'* ]]
}

find_runtime_port() {
  local preferred="$1"
  local kind="$2"
  local candidate
  for candidate in "$preferred" "$((preferred + 10000))" "$((preferred + 20000))"; do
    local health_url
    health_url="$(access_url "$candidate")/health"
    if [[ "$kind" == "python" ]]; then
      if is_graphinsight_python "$health_url"; then
        echo "$candidate"
        return 0
      fi
    else
      if is_graphinsight_go "$health_url"; then
        echo "$candidate"
        return 0
      fi
    fi
    if ! is_listening "$candidate"; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

resolve_runtime_ports() {
  local resolved_python resolved_go
  resolved_python="$(find_runtime_port "$PYTHON_PORT" python)" || {
    echo "[dev-backend] unable to find available Python port starting from $PYTHON_PORT" >&2
    return 1
  }
  if [[ "$resolved_python" != "$PYTHON_PORT" ]]; then
    echo "[dev-backend] Python port $PYTHON_PORT unavailable or not GraphInsight; using $resolved_python"
    PYTHON_PORT="$resolved_python"
  fi

  resolved_go="$(find_runtime_port "$GO_PORT" go)" || {
    echo "[dev-backend] unable to find available Go port starting from $GO_PORT" >&2
    return 1
  }
  if [[ "$resolved_go" != "$GO_PORT" ]]; then
    echo "[dev-backend] Go port $GO_PORT unavailable or not GraphInsight; using $resolved_go"
    GO_PORT="$resolved_go"
  fi
}

ensure_python_venv() {
  if [[ ! -x "$BACKEND_DIR/.venv/bin/python" ]]; then
    echo "[dev-backend] creating backend/.venv"
    python3 -m venv "$BACKEND_DIR/.venv"
  fi
  if [[ ! -x "$BACKEND_DIR/.venv/bin/uvicorn" ]]; then
    echo "[dev-backend] installing Python dependencies"
    "$BACKEND_DIR/.venv/bin/python" -m pip install -r "$BACKEND_DIR/requirements.txt"
  fi
}

ensure_neo4j() {
  if is_listening "$NEO4J_BOLT_PORT"; then
    echo "[dev-backend] Neo4j bolt port $NEO4J_BOLT_PORT is already listening"
    return
  fi

  echo "[dev-backend] starting Neo4j via docker compose"
  docker compose -f "$ROOT_DIR/docker-compose.dev.yml" up -d neo4j
}

write_dev_python_env() {
  resolve_admin_database_url
  cat >"$DEV_PYTHON_ENV_FILE" <<EOF
NEO4J_URI=$NEO4J_URI
NEO4J_USER=$NEO4J_USER
NEO4J_PASSWORD=$NEO4J_PASSWORD
NEO4J_DATABASE=$NEO4J_DATABASE
NEO4J_CONFIG_SOURCE=auto
API_HOST=$PYTHON_HOST
API_PORT=$PYTHON_PORT
MEDIA_STORAGE_PATH=$BACKEND_MEDIA_DIR
DOCUMENT_STORAGE_PATH=$BACKEND_DOCUMENTS_DIR
HTTP_CLIENT_TRUST_ENV=false
RBAC_AUTHZ_MODE=go_db
ADMIN_DATABASE_URL=$ADMIN_DATABASE_URL
EOF
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local attempts="${3:-40}"
  local i
  for ((i = 1; i <= attempts; i++)); do
    if http_ok "$url"; then
      echo "[dev-backend] $name is ready: $url"
      return
    fi
    sleep 1
  done
  echo "[dev-backend] $name did not become ready: $url" >&2
  return 1
}

start_python() {
  if is_graphinsight_python "$(access_url "$PYTHON_PORT")/health"; then
    echo "[dev-backend] Python capability service already running on $PYTHON_PORT"
    return
  fi
  if is_listening "$PYTHON_PORT"; then
    echo "[dev-backend] port $PYTHON_PORT is occupied; Python health check failed" >&2
    return 1
  fi

  ensure_python_venv
  write_dev_python_env
  echo "[dev-backend] starting Python capability service on $PYTHON_HOST:$PYTHON_PORT"
  (
    cd "$BACKEND_DIR"
    setsid env \
      GRAPHINSIGHT_BACKEND_ENV_FILE="$DEV_PYTHON_ENV_FILE" \
      API_HOST="$PYTHON_HOST" \
      API_PORT="$PYTHON_PORT" \
      NEO4J_URI="$NEO4J_URI" \
      NEO4J_USER="$NEO4J_USER" \
      NEO4J_PASSWORD="$NEO4J_PASSWORD" \
      NEO4J_DATABASE="$NEO4J_DATABASE" \
      ADMIN_DATABASE_URL="$ADMIN_DATABASE_URL" \
      "$BACKEND_DIR/.venv/bin/uvicorn" main:app --host "$PYTHON_HOST" --port "$PYTHON_PORT" \
      >"$LOG_DIR/python.log" 2>&1 < /dev/null &
    echo "$!" >"$(pid_file python)"
  )
  wait_for_http "Python capability service" "$(access_url "$PYTHON_PORT")/health" 60
}

start_go() {
  if is_graphinsight_go "$(access_url "$GO_PORT")/health"; then
    echo "[dev-backend] Go gateway already running on $GO_PORT"
    return
  fi
  if is_listening "$GO_PORT"; then
    echo "[dev-backend] port $GO_PORT is occupied; Go health check failed" >&2
    return 1
  fi

  echo "[dev-backend] starting Go gateway on $GO_HOST:$GO_PORT"
  resolve_admin_database_url
  (
    cd "$GO_BACKEND_DIR"
    setsid env \
      API_HOST="$GO_HOST" \
      API_PORT="$GO_PORT" \
      PYTHON_BACKEND_BASE_URL="$(access_url "$PYTHON_PORT")" \
      MEDIA_STORAGE_PATH="$BACKEND_MEDIA_DIR" \
      DOCUMENT_STORAGE_PATH="$BACKEND_DOCUMENTS_DIR" \
      RBAC_AUTHZ_MODE=go_db \
      NEO4J_URI="$NEO4J_URI" \
      NEO4J_USER="$NEO4J_USER" \
      NEO4J_PASSWORD="$NEO4J_PASSWORD" \
      NEO4J_DATABASE="$NEO4J_DATABASE" \
      NEO4J_CONFIG_SOURCE=auto \
      ADMIN_DATABASE_URL="$ADMIN_DATABASE_URL" \
      go run ./cmd/api \
      >"$LOG_DIR/go.log" 2>&1 < /dev/null &
    echo "$!" >"$(pid_file go)"
  )
  wait_for_http "Go gateway" "$(access_url "$GO_PORT")/health" 60
}

stop_one() {
  local name="$1"
  local file
  file="$(pid_file "$name")"
  if [[ ! -f "$file" ]]; then
    return
  fi
  local pid
  pid="$(cat "$file")"
  if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
    echo "[dev-backend] stopping $name pid $pid"
    kill -- "-$pid" >/dev/null 2>&1 || true
    pkill -P "$pid" >/dev/null 2>&1 || true
    kill "$pid" >/dev/null 2>&1 || true
  fi
  rm -f "$file"
}

print_status() {
  echo "[dev-backend] Postgres    : 127.0.0.1:$ADMIN_DB_PORT/$ADMIN_DB_NAME"
  echo "[dev-backend] Neo4j HTTP  : http://127.0.0.1:$NEO4J_HTTP_PORT"
  echo "[dev-backend] Neo4j Bolt  : 127.0.0.1:$NEO4J_BOLT_PORT"
  echo "[dev-backend] Python listen : http://$PYTHON_HOST:$PYTHON_PORT"
  echo "[dev-backend] Go listen     : http://$GO_HOST:$GO_PORT"
  echo "[dev-backend] Python access : $(access_url "$PYTHON_PORT")/health"
  echo "[dev-backend] Go access     : $(access_url "$GO_PORT")/health"
  docker compose -f "$ROOT_DIR/docker-compose.dev.yml" ps postgres neo4j || true
  curl -fsS "$(access_url "$PYTHON_PORT")/health" >/dev/null 2>&1 && echo "[dev-backend] Python health: ok" || echo "[dev-backend] Python health: unavailable"
  curl -fsS "$(access_url "$GO_PORT")/health" >/dev/null 2>&1 && echo "[dev-backend] Go health: ok" || echo "[dev-backend] Go health: unavailable"
}

write_runtime_env() {
  cat >"$RUNTIME_ENV_FILE" <<EOF
PYTHON_BASE_URL=$(access_url "$PYTHON_PORT")
GO_BASE_URL=$(access_url "$GO_PORT")
ADMIN_BASE_URL=$(access_url "$GO_PORT")
EOF
}

case "$command" in
  up)
    resolve_runtime_ports
    ensure_postgres
    ensure_neo4j
    start_python
    start_go
    write_runtime_env
    print_status
    ;;
  stop)
    stop_one go
    stop_one python
    rm -f "$RUNTIME_ENV_FILE"
    ;;
  restart)
    "$0" stop
    "$0" up
    ;;
  status)
    resolve_runtime_ports
    write_runtime_env
    print_status
    ;;
  logs)
    touch "$LOG_DIR/python.log" "$LOG_DIR/go.log"
    tail -f "$LOG_DIR/python.log" "$LOG_DIR/go.log"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
