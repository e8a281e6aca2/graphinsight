# GraphInsight Go Backend

This directory contains the Go external gateway and orchestration layer for GraphInsight.

Current execution model:

1. Go is the default external API entry.
2. Python remains the upstream capability layer for AI, document parsing, and model-facing flows.
3. Admin control-plane routes are owned by Go at the entry layer.
4. Python executes capability work and background admin jobs by polling `admin_jobs` from the shared admin database.

## Features in this bootstrap

1. Standard HTTP server with graceful shutdown
2. Config loading from environment variables
3. Structured JSON logging via `log/slog`
4. Core middleware: CORS, recovery, request logging
5. Basic endpoints: `/` and `/health`
6. Contract-compatible query endpoint: `POST /api/query`
7. Contract-compatible graph endpoints: `POST /api/expand`, `GET /api/node/{id}`
8. RBAC guard on Go native business APIs (compatible with admin token flow)
9. Go orchestrated extraction routes (Python keeps extraction algorithms)
10. Hybrid orchestration to Python internal capability routes only; `/api/media/**` is served natively by Go in unified mode

## Run locally

```bash
cd go-backend
go run ./cmd/api
```

Default address: `0.0.0.0:8081`

The default port is not exclusive. If `8081` is already occupied by another non-GraphInsight service, the repository startup script will fall back to another port and write the resolved address to `logs/dev/runtime.env`.

Recommended local startup order:

1. Start Python backend first on `http://127.0.0.1:8001`
2. Start Go gateway on `http://127.0.0.1:8081`
3. Point frontend and smoke checks to Go

When using `scripts/dev-backend.sh`, treat `logs/dev/runtime.env` as the source of truth for `GO_BASE_URL` and `PYTHON_BASE_URL`.
For browser-driven local QA, prefer `VITE_API_BASE_URL=same-origin` so the browser uses the current frontend origin instead of hard-coding a cross-origin backend URL. For Node-side E2E helpers and smoke checks, use `ADMIN_BASE_URL` or `E2E_API_BASE_URL` explicitly.

## Run tests

```bash
cd go-backend
go test ./...
```

Current tests include:

1. RBAC guard contract behavior (`RBAC_ENFORCE_BUSINESS_API=true/false`)
2. Upstream authorize client behavior (`200/401/403/5xx`)
3. `GET /api/node/{id}` response contract (200/404/500)
4. Media mapping rules (EN/CN keys, dedupe, thumbnail/url normalization)
5. Python API fixture contract checks (`testdata/contracts/python/*.json`)

## Environment variables

See `.env.example`.

Local hybrid development note:

1. Go will first try `go-backend/.env`.
2. If that file does not exist, it will fall back to `backend/.env`.
3. 本地 Linux 开发优先使用 `scripts/dev-backend.sh`，该脚本会显式注入本地 Docker PostgreSQL 与 Neo4j 配置，不依赖 `backend/.env` 中的历史值。
4. Explicit shell environment variables still take precedence.

Key vars:

1. `API_HOST`
2. `API_PORT`
3. `LOG_LEVEL`
4. `CORS_ALLOWED_ORIGINS`
5. `NEO4J_URI`
6. `NEO4J_USER`
7. `NEO4J_PASSWORD`
8. `NEO4J_DATABASE`
9. `NEO4J_CONFIG_SOURCE`: `env`, `admin`, or `auto` (recommended unified dev default)
10. `PYTHON_BACKEND_BASE_URL`
11. `PYTHON_BACKEND_TIMEOUT_SECONDS`
12. `GRAPH_BUILD_TIMEOUT_SECONDS`
13. `PYTHON_BACKEND_FORWARD_AUTH`
14. `HTTP_WRITE_TIMEOUT_SECONDS`
15. `ORCHESTRATOR_RETRY_MAX`
16. `ORCHESTRATOR_RETRY_BACKOFF_MS`
17. `ORCHESTRATOR_RETRY_MAX_BACKOFF_MS`
18. `ORCHESTRATOR_SAFE_RETRY_DOCQA`
19. `IDEMPOTENCY_CACHE_TTL_SECONDS`
20. `RBAC_ENFORCE_BUSINESS_API` (default: `true`; set `false` only for local migration diagnostics)
21. `RBAC_AUTHZ_MODE`: `go_db` (default and recommended unified mode) or `local_jwt_soft`. `local_jwt` is normalized to `local_jwt_soft`; unsupported values fall back to `go_db`.
22. `ADMIN_SECRET_KEY`: shared HS256 secret used when `RBAC_AUTHZ_MODE=local_jwt_soft|go_db`; it must match Python's `ADMIN_SECRET_KEY`.
23. `ADMIN_DATABASE_URL`: admin PostgreSQL database used by `RBAC_AUTHZ_MODE=go_db` and `NEO4J_CONFIG_SOURCE=admin|auto`.

Default local CORS allowlist also includes `http://localhost:1234` and `http://127.0.0.1:1234` so browser QA can run against the current verified local frontend port without extra manual env changes.

RBAC authz mode:

- `local_jwt_soft`: migration-only mode. Go validates the JWT signature and expiry locally, then sets `x-authz-reason=local_jwt_soft_allow`. It does not check user activation or role bindings because current Python admin tokens only contain `sub` and `exp`.
- `go_db`: recommended unified mode. Go validates the JWT locally, resolves the active admin user by `sub`, and evaluates RBAC bindings from the admin database using read-only queries.

If `RBAC_AUTHZ_MODE` is omitted, Go now defaults to `go_db` so unified deployments do not silently fall back to Python compatibility authz.

Neo4j config source:

- `env`: Go reads `NEO4J_URI`, `NEO4J_USER` / `NEO4J_USERNAME`, `NEO4J_PASSWORD`, and `NEO4J_DATABASE`.
- `admin`: Go reads `admin_configs` directly from the admin PostgreSQL database during startup.
- `auto`: Go tries admin database config first, then falls back to env if the admin DB config is unavailable or incomplete.

Unified local development started through [scripts/dev-backend.sh](/home/yuanhuan/GraphInsight/scripts/dev-backend.sh) now writes `NEO4J_CONFIG_SOURCE=auto` by default so the admin console can take over Neo4j connection settings without losing env fallback.

Admin config is resolved at Go startup. Restart the Go gateway after changing Neo4j settings in the admin console.

## Query API example

```bash
curl -X POST http://localhost:8081/api/query \
  -H 'Content-Type: application/json' \
  -d '{"cypher":"MATCH (n)-[r]->(m) RETURN n,r,m LIMIT 20"}'
```

Expected response shape:

```json
{
  "code": 200,
  "message": "查询成功",
  "data": {
    "nodes": [],
    "edges": [],
    "stats": {
      "nodeCount": 0,
      "edgeCount": 0,
      "executionTime": 0.012
    }
  },
  "timestamp": "2026-05-14T00:00:00Z",
  "trace_id": "trace-id"
}
```

## Expand API example

```bash
curl -X POST http://localhost:8081/api/expand \
  -H 'Content-Type: application/json' \
  -d '{"nodeId":"123","direction":"both","limit":20}'
```

`nodeId` supports both Neo4j `id(n)` (numeric string) and `elementId(n)` (string id).

## Current route ownership

1. `go-native`: `/health`, `/api/query`, `/api/expand`, `/api/node/{id}`, `/api/media/**`, `/api/client-logs`, `/api/proxy-media`, `/api/proxy-image`, `/api/video-thumbnail`, and current Go-owned admin routes.
2. `go-orchestrator`: DocQA, deep research, and `POST /api/nl2cypher`.

Python public business routes are no longer part of the Python runtime surface. Go calls Python `/api/internal/*` capability entrypoints directly.

In unified deployment, only `/api/internal/*` remains usable as the Python capability plane. Any direct hit to the old Python public business paths returns `404`.

Unknown `/api/v1/**` routes are not proxied. Unknown admin paths return Go-owned 404 responses.

Go marks responses with `X-GraphInsight-Route-Owner` so smoke tests and operators can see which layer owns a request.

## Orchestrated Routes (Go -> Python)

1. `POST /api/docqa`
2. `POST /api/docqa/deep-research`
3. `GET /api/docqa/health`

Current Python upstream targets for DocQA:

1. `POST /api/internal/docqa`
2. `POST /api/internal/docqa/deep-research`
3. `GET /api/internal/docqa/health`

Current Python upstream targets for documents and graph build:

1. `POST /api/internal/jobs/wake`

Current Python upstream targets for NL2Cypher:

1. `POST /api/internal/nl2cypher`

Go keeps the public business routes under `/api/docqa*`; the internal Python routes are capability-only entrypoints and should not be called directly by frontend code.
Go also owns these public business routes natively:

1. `GET /api/documents`
2. `GET /api/documents/deleted`
3. `DELETE /api/documents`
4. `DELETE /api/documents/{doc_id}`
5. `POST /api/documents/{doc_id}/restore`
6. `POST /api/documents/upload`
7. `POST /api/graph/build`
8. `GET /api/nl2cypher/examples`
9. `GET /api/nl2cypher/status`
10. `GET /api/monitor/orchestrator` (Go side upstream metrics)

## Auth Context Propagation

For orchestrated business routes, Go forwards resolved auth context headers to Python:

1. `x-auth-user-id`
2. `x-auth-user-name`
3. `x-auth-user-email`
4. `x-authz-permission`
5. `x-authz-reason`

## Refresh Python Fixtures

Use this script to refresh Go contract fixtures from a running Python backend:

```bash
cd go-backend
python scripts/refresh_python_contract_fixtures.py --base-url http://127.0.0.1:8001 --token <admin_jwt_optional>
```

Output files:

1. `testdata/contracts/python/query_success.json`
2. `testdata/contracts/python/expand_success.json`
3. `testdata/contracts/python/node_success.json`
4. `testdata/contracts/python/node_not_found_error.json`

## Smoke Test (Orchestrated Routes)

```bash
cd go-backend
python scripts/smoke_orchestrated_routes.py --go-base-url http://127.0.0.1:8081 --require-orchestrator-connected
```

Optional write-path checks:

1. `--with-build` to trigger `/api/graph/build`
2. `--with-upload` to verify multipart upload orchestration

## Retry Policy

Orchestrated upstream retries are enabled for `GET` routes only:

1. Retryable status codes: `429`, `502`, `503`, `504`
2. Exponential backoff controlled by:
   `ORCHESTRATOR_RETRY_MAX`, `ORCHESTRATOR_RETRY_BACKOFF_MS`, `ORCHESTRATOR_RETRY_MAX_BACKOFF_MS`
3. Non-idempotent write routes (`POST/DELETE/upload`) are not auto-retried by default.
4. Optional safe retry for read-like QA POST routes: set `ORCHESTRATOR_SAFE_RETRY_DOCQA=true` to retry `/api/docqa` and `/api/docqa/deep-research`.

## Idempotency Key (Build Job)

`POST /api/graph/build` supports idempotency keys:

1. Request header: `Idempotency-Key` (or `x-idempotency-key`)
2. Same key + same request body: replay cached response (within `IDEMPOTENCY_CACHE_TTL_SECONDS`)
3. Same key + different request body: return `409 IDEMPOTENCY_KEY_CONFLICT`

## Long Build Timeouts

`POST /api/graph/build` can take significantly longer than read-like orchestrated routes when the knowledge base is large.

Recommended timeout knobs:

1. `GRAPH_BUILD_TIMEOUT_SECONDS`: Go build-job submission path and downstream worker processing timeout knob. Default `300`.
2. `HTTP_WRITE_TIMEOUT_SECONDS`: Go gateway response write timeout. Default `300`.
3. `PYTHON_BACKEND_TIMEOUT_SECONDS`: shared upstream timeout for regular orchestrated routes. Default `60`.

## Orchestrator Metrics

`GET /api/monitor/orchestrator` returns in-memory upstream orchestration metrics:

1. Per-route request count / failed count
2. Avg / max latency
3. Error taxonomy (`success`, `upstream_5xx`, `upstream_transport_error`, etc.)
4. Last status / last error

`GET /health` also includes a lightweight `orchestrator_metrics` summary.

Its `authz` payload now reports the actual permission mode in use:

1. `mode=go_db`: permission checks are resolved locally by Go against admin tables.
2. `mode=local_jwt_soft`: permission checks are local compatibility mode without upstream authz calls.

## Next migration step

1. Move Python-backed admin proxy modules to native Go implementations by priority.
2. Replace Python upstream authorization checks with native Go RBAC decisions when the permission model is fully mirrored.
