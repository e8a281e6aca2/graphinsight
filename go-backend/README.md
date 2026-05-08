# GraphInsight Go Backend

This directory contains the Go external gateway and orchestration layer for GraphInsight.

Current execution model:

1. Go is the default external API entry.
2. Python remains the upstream capability layer for AI, document parsing, and model-facing flows.
3. Some admin routes are still proxied to Python and will be gradually pulled into Go.

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
10. Hybrid proxy routes to Python backend (media flow and part of admin flow)

## Run locally

```bash
cd go-backend
go run ./cmd/api
```

Default address: `0.0.0.0:8081`

Recommended local startup order:

1. Start Python backend first on `http://127.0.0.1:8001`
2. Start Go gateway on `http://127.0.0.1:8081`
3. Point frontend and smoke checks to Go

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
3. When falling back to `backend/.env`, Go ignores Python listener keys such as `API_HOST` and `API_PORT`; this prevents Python's `8001` port from overriding Go's default `8081`.
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
9. `PYTHON_BACKEND_BASE_URL`
10. `PYTHON_BACKEND_TIMEOUT_SECONDS`
11. `GRAPH_BUILD_TIMEOUT_SECONDS`
12. `PYTHON_BACKEND_FORWARD_AUTH`
13. `HTTP_WRITE_TIMEOUT_SECONDS`
14. `ORCHESTRATOR_RETRY_MAX`
15. `ORCHESTRATOR_RETRY_BACKOFF_MS`
16. `ORCHESTRATOR_RETRY_MAX_BACKOFF_MS`
17. `ORCHESTRATOR_SAFE_RETRY_DOCQA`
18. `IDEMPOTENCY_CACHE_TTL_SECONDS`
19. `RBAC_ENFORCE_BUSINESS_API`

## Query API example

```bash
curl -X POST http://localhost:8081/api/query \
  -H 'Content-Type: application/json' \
  -d '{"cypher":"MATCH (n)-[r]->(m) RETURN n,r,m LIMIT 20"}'
```

Expected response shape:

```json
{
  "nodes": [],
  "edges": [],
  "stats": {
    "nodeCount": 0,
    "edgeCount": 0,
    "executionTime": 0.012
  }
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

1. `go-native`: `/health`, `/api/query`, `/api/expand`, `/api/node/{id}`.
2. `go-orchestrator`: document, graph build, DocQA, deep research, and NL2Cypher business routes.
3. `go-admin-proxy`: known admin modules such as auth, config, monitor, jobs, QA traces, logs, RBAC, users, and profile.
4. `python-proxy`: legacy fallback routes such as `/api/media/**` and unknown `/api/v1/**` compatibility paths.

Go marks responses with `X-GraphInsight-Route-Owner` so smoke tests and operators can see which layer owns a request.

## Orchestrated Routes (Go -> Python)

1. `POST /api/graph/build`
2. `POST /api/docqa`
3. `POST /api/docqa/deep-research`
4. `GET /api/docqa/health`
5. `GET /api/documents`
6. `DELETE /api/documents`
7. `DELETE /api/documents/{doc_id}`
8. `POST /api/documents/upload`
9. `GET /api/monitor/orchestrator` (Go side upstream metrics)

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

1. `GRAPH_BUILD_TIMEOUT_SECONDS`: upstream Python build timeout for the Go orchestrator route. Default `300`.
2. `HTTP_WRITE_TIMEOUT_SECONDS`: Go gateway response write timeout. Default `300`.
3. `PYTHON_BACKEND_TIMEOUT_SECONDS`: shared upstream timeout for regular orchestrated routes. Default `60`.

## Orchestrator Metrics

`GET /api/monitor/orchestrator` returns in-memory upstream orchestration metrics:

1. Per-route request count / failed count
2. Avg / max latency
3. Error taxonomy (`success`, `upstream_5xx`, `upstream_transport_error`, etc.)
4. Last status / last error

`GET /health` also includes a lightweight `orchestrator_metrics` summary.

## Next migration step

1. Make Go the default path for frontend, smoke, and preflight checks.
2. Pull `monitor / jobs / qa-traces` out of blanket `/api/v1/**` proxy ownership.
