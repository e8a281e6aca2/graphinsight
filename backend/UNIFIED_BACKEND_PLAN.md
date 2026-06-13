# Unified Backend Plan

Updated: 2026-06-07

## Target

GraphInsight keeps two backend runtimes, but exposes one backend entry:

1. Go gateway is the only external API entry: `http://127.0.0.1:8081`.
2. Python is an internal capability service: `http://127.0.0.1:8001`.
3. Frontend, smoke tests, and E2E should call Go by default.
4. Python stays responsible for AI-heavy capabilities, not public control-plane ownership.
5. Python runtime registration should make that split explicit: only `/api/internal/*` capability mounts remain.

## Linux Dev Runtime

Use the repository-level script:

```bash
scripts/dev-backend.sh up
```

The script:

1. Starts development PostgreSQL and Neo4j with `docker-compose.dev.yml` when they are not already available.
2. Ensures `backend/.venv` exists and has backend dependencies.
3. Starts Python on `0.0.0.0:8001`.
4. Starts Go on `0.0.0.0:8081` by default, but automatically falls back to another free port when `8081` is occupied by a non-GraphInsight service.
5. Writes runtime logs, resolved runtime addresses, and temporary dev env to `logs/dev/`.
6. Defaults `ADMIN_DATABASE_URL` to the local Docker PostgreSQL container, writes it into `logs/dev/backend.env`, and injects it into both runtimes so the Python job worker uses the same admin DB as the Go control plane.

Runtime address source of truth:

1. `logs/dev/runtime.env` records browser-usable access URLs for `PYTHON_BASE_URL`, `GO_BASE_URL`, and `ADMIN_BASE_URL`.
2. Smoke checks should prefer `logs/dev/runtime.env` instead of hardcoding `8081`.
3. A generic `200 /health` is not enough to identify GraphInsight on this machine; startup and smoke checks verify GraphInsight-specific response fields before reusing a running port.
4. `backend/tests/check_dev_runtime_defaults.py` validates that the startup script still writes unified defaults to `logs/dev/backend.env` and that current Go/Python `/health` matches those defaults.
5. The same runtime-default check also guards that `ADMIN_DATABASE_URL` is present and not the placeholder local fallback, because missing admin DB config breaks Python job execution even when Go health looks normal.

Stop Go and Python processes started by the script:

```bash
scripts/dev-backend.sh stop
```

Neo4j is intentionally left running. Stop it separately when needed:

```bash
docker compose -f docker-compose.dev.yml stop neo4j
```

## Current Route Ownership

Go native:

1. `GET /`
2. `GET /health`
3. `POST /api/query`
4. `GET /api/graph/schema`
5. `POST /api/expand`
6. `GET /api/node/{id}`
7. `GET /api/monitor/orchestrator`
8. `POST /api/client-logs`
9. `GET /api/proxy-media`
10. `GET /api/proxy-image`
11. `GET /api/video-thumbnail`
12. `GET /api/v1/admin/monitor/stats`
13. `GET /api/v1/admin/monitor/health`
14. `GET /api/v1/admin/monitor/performance`
15. `GET /api/v1/admin/monitor/slo`
16. `GET /api/v1/admin/monitor/metrics/unified`
17. `GET /api/v1/admin/monitor/qa`
18. `POST /api/v1/admin/monitor/alerts/check`
19. `GET /api/v1/admin/monitor/log-severity`
20. `GET /api/v1/admin/qa-traces`
21. `GET /api/v1/admin/qa-traces/{trace_id_or_pk}`
22. `GET /api/v1/admin/qa-traces/cost-summary`
23. `GET /api/v1/admin/jobs`
24. `GET /api/v1/admin/jobs/{job_id}`
25. `GET /api/v1/admin/jobs/{job_id}/logs`
26. `POST /api/v1/admin/jobs/build-graph`
27. `POST /api/v1/admin/jobs/clear-kb`
28. `POST /api/v1/admin/jobs/reindex`
29. `POST /api/v1/admin/jobs/{job_id}:retry`
30. `POST /api/v1/admin/jobs/{job_id}:cancel`
31. `GET /api/v1/admin/logs`
32. `GET /api/v1/admin/logs/{log_id}`
33. `GET /api/v1/admin/logs/stats/summary`
34. `GET /api/v1/admin/logs/recent/list`
35. `DELETE /api/v1/admin/logs/clean`
36. `GET /api/v1/admin/config`
37. `GET /api/v1/admin/config/{category}`
38. `GET /api/v1/admin/config/{category}/{key}`
39. `GET /api/v1/admin/config/neo4j/all`
40. `GET /api/v1/admin/config/ai-service/all`
41. `GET /api/v1/admin/config/openai/all`
42. `GET /api/v1/admin/config/nl2cypher/all`
43. `GET /api/v1/admin/config/openai/models`
44. `GET /api/v1/admin/config/test/model/latest`
45. `GET /api/v1/admin/rbac/roles`
46. `GET /api/v1/admin/rbac/permissions`
47. `GET /api/v1/admin/rbac/bindings`
48. `POST /api/v1/admin/rbac/bindings`
49. `DELETE /api/v1/admin/rbac/bindings/{binding_id}`
50. `GET /api/v1/admin/users`
51. `POST /api/v1/admin/users`
52. `PUT /api/v1/admin/users/{user_id}`
53. `POST /api/v1/admin/users/{user_id}/toggle-status`
54. `POST /api/v1/admin/users/{user_id}/reset-password`
55. `DELETE /api/v1/admin/users/{user_id}`
56. `POST /api/v1/admin/users/batch-status`
57. `POST /api/v1/admin/users/batch-delete`
58. `POST /api/v1/admin/users/batch-reset-password`
59. `GET /api/v1/admin/users/export-csv`
60. `GET /api/v1/admin/profile`
61. `GET /api/v1/admin/profile/stats`
62. `PUT /api/v1/admin/profile`
63. `PUT /api/v1/admin/profile/password`
64. `POST /api/v1/admin/auth/login`
65. `POST /api/v1/admin/auth/register`
66. `POST /api/v1/admin/auth/logout`
67. `GET /api/v1/admin/auth/me`
68. `POST /api/v1/admin/auth/change-password`
69. `GET /api/v1/admin/auth/authorize`
70. `GET /api/v1/admin/auth/profile` (legacy alias; prefer `/api/v1/admin/auth/me` for new code)

Go orchestrates, Python executes:

1. `POST /api/docqa`
2. `POST /api/docqa/deep-research`
3. `GET /api/docqa/health`
4. `POST /api/nl2cypher`

Go native:

1. `GET /api/nl2cypher/examples`
2. `GET /api/nl2cypher/status`

Python internal capability entrypoints used by Go:

1. `POST /api/internal/docqa`
2. `POST /api/internal/docqa/deep-research`
3. `GET /api/internal/docqa/health`
4. `POST /api/internal/nl2cypher`

Execution boundary:

1. Go owns admin job creation, retry, cancel, query, and audit writes in `admin_jobs` and `admin_logs`.
2. Python owns job execution for runnable capability jobs (`build_graph`, `clear_kb`, `reindex`) through a process-local background worker that polls pending rows from `admin_jobs`.
3. Python claims pending jobs by transitioning them to `running` before execution, then writes terminal status and result back to `admin_jobs`.
4. Python worker lease fields are stored on `admin_jobs`: `claimed_by`, `claim_expires_at`, and `last_heartbeat_at`.
5. Worker heartbeat extends `claim_expires_at` while the task is running, so stale claims can expire and be safely re-claimed by another Python process.
6. Python worker also recovers stale `running` jobs whose lease has expired by re-queueing them to `pending` before polling new work.
7. Auto-retry scheduling remains Python-owned, but it now re-queues failed jobs back to `pending` in the database instead of relying on the original HTTP request lifecycle.
8. Go now best-effort nudges Python through `POST /api/internal/jobs/wake` after job create and retry, while Python polling remains the fallback path if the wake call fails.
9. Python's own mounted admin jobs routes use the same worker wake path and no longer execute jobs via request-scoped `BackgroundTasks`.
10. Go now calls Python internal DocQA capability routes (`/api/internal/docqa*`) instead of Python's externally mounted `/api/docqa*` business routes, so external authz remains Go-owned while Python still records QA traces and executes the capability logic.
11. Go now also calls Python internal NL2Cypher capability routes (`/api/internal/nl2cypher*`) instead of Python's externally mounted `/api/nl2cypher*` business routes, keeping public access control and route ownership on the Go side.
12. `GET /api/nl2cypher/examples` and `GET /api/nl2cypher/status` are now served natively by Go; `POST /api/nl2cypher` remains Go-orchestrated to Python for model inference.
13. Go now validates the public `POST /api/nl2cypher` request body before forwarding to Python, so malformed JSON and blank `natural_language` requests fail at the external entry layer instead of leaking into the Python capability plane.
14. Go now owns the public `documents` surface end to end for list/upload/delete/restore/clear flows, including file-system mutations, trash metadata, and document-graph delete/clear execution against Neo4j.
15. Go now owns the public `documents` surface end to end, and Python document route implementations are no longer part of the default mounted unified runtime surface, supported diagnostic surface, or `api/routes` source tree.
16. Go now owns the public `POST /api/graph/build` entrypoint as a native build-job submission path with idempotency replay, task audit, and worker wake-up; Python executes the resulting `build_graph` jobs through the shared worker.
17. Python internal graph build capability route is no longer part of the default mounted unified runtime surface or the supported diagnostic surface, and the retired `api/routes/graph_build.py` source implementation has been removed.
18. Python capability, worker, QA trace, and monitor execution paths now read runtime config through dedicated helpers in `services/runtime_config.py`; they should not directly depend on `admin.services.config_service` for routine execution-time reads.
19. DocQA capability routes now write QA traces through `services/qa_trace_runtime.py`, keeping direct admin QA trace schema/service imports out of `api/routes/doc_qa.py`.
20. Python internal capability routes now obtain admin DB sessions through `services/runtime_db.py`, so `api/routes/*` no longer imports `admin.database` directly for runtime dependency injection.
21. The retired Python documents route implementation has been removed; Go remains the public documents owner and Python no longer keeps an unmounted documents route module under `api/routes`.
22. Python runnable job execution is delegated to `services/job_runtime.py`; `admin/services/job_service.py` keeps the task state machine, lease, heartbeat, retry, and audit behavior but no longer owns graph build, clear-kb, or reindex capability implementation directly.

Required Python job-worker settings:

1. `JOB_WORKER_ENABLED=true|false` (default `true`)
2. `JOB_WORKER_POLL_INTERVAL_SECONDS` (default `2`)
3. `JOB_WORKER_STOP_TIMEOUT_SECONDS` (default `5`)
4. `JOB_WORKER_LEASE_SECONDS` (default `30`)
5. `RBAC_AUTHZ_MODE=go_db` in unified mode

Required schema step:

```bash
cd backend
./.venv/bin/python admin/migrate_job_worker_lease.py
```

Go admin control plane ownership:

1. No admin compatibility proxy routes remain mounted; Go owns the admin control plane directly.
2. `/api/media/*` is now served directly by Go from the shared media storage path instead of being proxied to Python.

Python public business route state:

1. Public business route families now fully owned by Go and removed from Python source/runtime:
   - `/api/graph/build`
   - `/api/documents*`
   - `/api/docqa*`
   - `/api/nl2cypher*`
   - `/api/query`
   - `/api/expand`
   - `/api/node/{node_id}`
   - `/api/graph/schema`
   - `/api/media/**`
   - `/api/client-logs`
   - `/api/proxy-media`
   - `/api/proxy-image`
   - `/api/video-thumbnail`

Rules for this business boundary:

1. Go's unified external path no longer depends on Python public business routes as upstream targets.
2. External callers in unified mode should use Go-native public routes; direct hits to the removed Python public paths return ordinary `404`.
3. `/api/internal/*` remains the only supported Python capability plane for Go orchestration and explicit diagnosis, but only for the routes still mounted in unified runtime.
4. Shared business implementations stay under `api/routes/*`, internal capability routers stay under `api/routes/*_internal.py`.
5. The removed `api/compat_routes/*`, `api/routes/*_public.py`, and legacy public route layers must not be recreated.
6. `admin/api/endpoints/*` remains the place for shared admin implementation, internal capability endpoints, and Go-only compatibility exceptions such as authz.
7. Python business capability routes now require both a Go internal marker header and a non-empty `X-Trace-Id`; missing trace context is treated as a contract violation and rejected with `400`.
8. Python business capability routes accept only `X-Go-Orchestrator=graphinsight-go`; the broader `X-Go-Proxy=graphinsight-go` marker is not enough for business capability execution.
9. Python capability/runtime services should prefer dedicated runtime config helpers over direct control-plane service imports, so execution-time reads stay separated from Go-owned admin APIs and admin service composition.
10. Direct imports of `admin.database`, `admin.schemas`, or `admin.services` from Python business route modules should remain confined to runtime adapter modules such as `services/runtime_db.py`, `services/runtime_config.py`, and `services/qa_trace_runtime.py`.

Python admin capability surface:

1. Python no longer mounts public `/api/v1/admin/auth/*` or `/api/v1/admin/jobs*` compatibility modules.
2. Unified external control-plane traffic must use Go-owned admin routes.
3. `POST /api/internal/jobs/wake` remains available for Go to nudge the Python job worker without re-exposing Python under `/api/v1/admin/*`.
4. Python recognizes Go-only internal compatibility traffic by the shared `graphinsight-go` value on `X-Go-Orchestrator` or `X-Go-Proxy`.
5. Historical Python admin public route modules for `auth`, `jobs`, `config`, `monitor`, `logs`, `profile`, `qa-traces`, `rbac`, and `users` have been removed from source and are no longer part of the runtime surface.
6. `POST /api/internal/jobs/wake` remains the only Python internal admin endpoint that accepts `X-Go-Proxy` without the stricter business capability trace contract; business capability routes use `X-Go-Orchestrator` plus mandatory `X-Trace-Id`.
7. This keeps two internal classes distinct:
   - `X-Go-Orchestrator`: Go business orchestration into Python capability plane.
   - `X-Go-Proxy`: Go internal control-plane signals such as worker wake-ups.

Unknown route rules:

1. Unknown `/api/v1/admin/*` routes are Go-owned 404 responses.
2. Unknown non-admin `/api/v1/**` routes are not proxied to Python.

## Migration Order

1. `monitor`: read-heavy and safe to use as the first Go-native control-plane module.
2. `qa-traces`: clear query surface for list/detail/cost summary.
3. `jobs`: core control plane, but requires careful state-machine handling.
4. `auth` and `rbac`: removes Go runtime dependence on Python authorize.
5. `logs`: depends on stable audit context.
6. `config`: handles sensitive values and runtime provider tests, so migrate later.
7. `users` and `profile`: migrate after auth/rbac data ownership is stable.

## Migration Definition Of Done

For each migrated module:

1. Go handler no longer calls the same Python admin route.
2. Permission decision is native Go, or the remaining temporary dependency is documented.
3. Response shape keeps `code`, `message`, `data`, `timestamp`, and `trace_id`.
4. Write APIs preserve operator context and audit fields.
5. Go unit tests cover method, permission, success, and error behavior.
6. Smoke or preflight coverage is updated when the external contract changes.
7. This file's route ownership section is updated.

## Authz Migration State

Go supports three business permission modes:

1. `RBAC_AUTHZ_MODE=local_jwt_soft`: migration-only. Go validates Python-compatible HS256 admin JWTs locally with `ADMIN_SECRET_KEY` and propagates `x-authz-reason=local_jwt_soft_allow`. Legacy `local_jwt` input is normalized to `local_jwt_soft`.
2. `RBAC_AUTHZ_MODE=go_db`: default and recommended unified mode. Go validates Python-compatible HS256 admin JWTs locally, resolves active users from `admin_users`, and evaluates scope-aware RBAC bindings from `admin_user_role_bindings`, `admin_roles`, `admin_role_permissions`, and `admin_permissions` with read-only queries.
3. Unsupported `RBAC_AUTHZ_MODE` values are normalized back to `go_db` at Go config load time.

`go_db` keeps authz fully inside Go while still using Python's current admin tables. Write-side role binding management remains Python-owned until audit and mutation behavior are migrated.

Go Neo4j config resolution state:

1. `NEO4J_CONFIG_SOURCE=env`: Go reads Neo4j settings from process env.
2. `NEO4J_CONFIG_SOURCE=admin`: Go reads Neo4j settings directly from `admin_configs` in the admin PostgreSQL database.
3. `NEO4J_CONFIG_SOURCE=auto`: Go tries `admin_configs` first, then falls back to env when the admin DB config is unavailable or incomplete.

Unified local development should now prefer `NEO4J_CONFIG_SOURCE=auto` so the admin console becomes the primary control plane for Neo4j while retaining a safe env fallback.

This removes the former Go startup dependency on Python `/api/v1/admin/config/neo4j/all`.

Go `/health` now reports the actual authz mode truthfully through `data.authz.mode`, `permission_check_via_upstream`, and `permission_check_via_local`. Unified mode should therefore show `mode=go_db` and `permission_check_via_upstream=false`.

## Python Admin Source Layout

Runtime Python admin APIs now separate into:

1. Shared implementation and internal capability endpoints under `backend/admin/api/endpoints/*`.
2. The older historical archive `backend/admin/_legacy_routes/*`, removed `legacy_debug_routes/*` layer, and removed `admin/api/compat_routes/*` layer must not be recreated.

## Deferred Data Wiring

Some Go-native admin routes are currently contract-compatible empty snapshots because the Go control plane has not yet taken ownership of the underlying admin relational tables:

1. `GET /api/v1/admin/monitor/*` derived charts that still need persisted aggregates beyond current API, QA, job SLO, and log read models.

These routes intentionally no longer proxy to Python admin APIs. Wire real persisted data after the Go data layer for each derived aggregate is defined.

## Persisted Go Read Models

The following Go-native admin routes now read the existing admin relational tables directly:

1. `GET /api/v1/admin/rbac/bindings`: `admin_user_role_bindings`, `admin_roles`, `admin_users`.
2. `GET /api/v1/admin/users`: `admin_users`.
3. `GET /api/v1/admin/profile`: `admin_users`.
4. `GET /api/v1/admin/profile/stats`: `admin_users`, `admin_logs`.
5. `POST /api/v1/admin/auth/login`: verifies `admin_users.password_hash`, updates login metadata, signs a Python-compatible HS256 JWT with `ADMIN_SECRET_KEY`, and writes a login audit log.
6. `POST /api/v1/admin/auth/register`: creates the first `admin_users` row only, grants global `super_admin`, and writes a register audit log.
7. `POST /api/v1/admin/auth/logout`: validates the JWT subject, writes a logout audit log, and keeps current stateless JWT semantics.
8. `GET /api/v1/admin/auth/me`: `admin_users`.
9. `POST /api/v1/admin/auth/change-password`: verifies the current password by JWT subject, writes a Go-generated bcrypt password hash, and writes an `admin_logs` audit entry.
10. `GET /api/v1/admin/auth/authorize`: validates the JWT subject from `admin_users` and evaluates scope-aware RBAC from the Go admin store.
11. `GET /api/v1/admin/auth/profile`: legacy alias of the current-user read path backed by `admin_users`; new callers should use `GET /api/v1/admin/auth/me`.
12. `GET /api/v1/admin/logs`: `admin_logs`, `admin_users`.
13. `GET /api/v1/admin/logs/{log_id}`: `admin_logs`, `admin_users`.
14. `GET /api/v1/admin/logs/stats/summary`: `admin_logs`, `admin_users`.
15. `GET /api/v1/admin/logs/recent/list`: `admin_logs`, `admin_users`.
16. `GET /api/v1/admin/qa-traces`: `admin_qa_traces`.
17. `GET /api/v1/admin/qa-traces/{trace_id_or_pk}`: `admin_qa_traces`.
18. `GET /api/v1/admin/qa-traces/cost-summary`: `admin_qa_traces`.
19. `GET /api/v1/admin/jobs`: `admin_jobs`.
20. `GET /api/v1/admin/jobs/{job_id}`: `admin_jobs`.
21. `GET /api/v1/admin/jobs/{job_id}/logs`: `admin_jobs`, `admin_logs`.
22. `POST /api/v1/admin/jobs/build-graph`: creates a pending `admin_jobs` row and writes `job_created` to `admin_logs`; Python worker later claims and executes it.
23. `POST /api/v1/admin/jobs/clear-kb`: creates a pending `admin_jobs` row and writes `job_created` to `admin_logs`; Python worker later claims and executes it.
24. `POST /api/v1/admin/jobs/reindex`: creates a pending `admin_jobs` row and writes `job_created` to `admin_logs`; Python worker later claims and executes it.
25. `POST /api/v1/admin/jobs/{job_id}:retry`: validates `failed/cancelled`, increments `retry_count`, resets runtime fields, and writes `job_retry_submitted` to `admin_logs`; Python worker later re-claims it.
26. `POST /api/v1/admin/jobs/{job_id}:cancel`: validates `pending/running`, marks the task `cancelled`, and writes `job_cancelled` to `admin_logs`.
27. `GET /api/v1/admin/config`: `admin_configs`.
28. `GET /api/v1/admin/config/{category}`: `admin_configs`.
29. `GET /api/v1/admin/config/{category}/{key}`: `admin_configs`.
30. `GET /api/v1/admin/config/neo4j/all`: `admin_configs` with environment fallback and secret redaction.
31. `GET /api/v1/admin/config/ai-service/all`: `admin_configs` with environment fallback and secret redaction.
32. `GET /api/v1/admin/config/openai/all`: `admin_configs` with environment fallback and secret redaction.
33. `GET /api/v1/admin/config/nl2cypher/all`: `admin_configs` with environment fallback.
34. `GET /api/v1/admin/config/openai/models`: Go static model catalog plus current model hint.
35. `GET /api/v1/admin/rbac/roles`: `admin_roles`.
36. `GET /api/v1/admin/rbac/permissions`: `admin_permissions`.
37. `GET /api/v1/admin/monitor/qa`: aggregate from `admin_qa_traces`.
38. `GET /api/v1/admin/monitor/log-severity`: aggregate from `admin_logs`.
39. `GET /api/v1/admin/monitor/slo`: API runtime metrics plus job SLO aggregate from `admin_jobs`.
40. `POST /api/v1/admin/monitor/alerts/check`: API runtime metrics plus job timeout aggregate from `admin_jobs`; webhook delivery remains disabled in Go-native check.
41. `GET /api/v1/admin/monitor/metrics/unified`: API runtime metrics plus QA, job SLO, and log severity aggregates from `admin_qa_traces`, `admin_jobs`, and `admin_logs`.
42. `GET /api/v1/admin/config/test/model/latest`: Go process-local snapshot captured from the latest successful Go-native `POST /api/v1/admin/config/test/model` probe.
43. `POST /api/v1/admin/config`: `admin_configs` write with `admin_logs` audit entry.
44. `PUT /api/v1/admin/config/{category}/{key}`: `admin_configs` update or auto-create with `admin_logs` audit entry.
45. `DELETE /api/v1/admin/config/{category}/{key}`: `admin_configs` delete with `admin_logs` audit entry.
46. `POST /api/v1/admin/config/batch`: existing `admin_configs` batch update with `admin_logs` audit entry.
47. `POST /api/v1/admin/config/init`: standard Neo4j and AI service environment/default config upsert with `admin_logs` audit entry.
48. `POST /api/v1/admin/config/test/neo4j`: Go-native Neo4j connectivity probe using the active resolved config snapshot.
49. `POST /api/v1/admin/config/test/ai_service`: Go-native AI service configuration validation for provider, enablement, API key presence, and compatible base URL requirements.
50. `POST /api/v1/admin/config/test/openai`: Go-native alias of the AI service configuration validation path.
51. `POST /api/v1/admin/config/test/model`: Go-native real model probe against the active configured endpoint, preserving `checked_at`, `latency_ms`, and `checks` snapshot fields for the latest result view.
52. `DELETE /api/v1/admin/logs/clean`: retention-based cleanup of `admin_logs`, supports `dry_run`, excludes the current `trace_id` when present, and writes an `admin_logs` audit entry on actual cleanup.
53. `POST /api/v1/admin/rbac/bindings`: creates or returns an existing `admin_user_role_bindings` row by user, role, and scope, validates scope fields, and writes an `admin_logs` audit entry for new bindings.
50. `DELETE /api/v1/admin/rbac/bindings/{binding_id}`: deletes an `admin_user_role_bindings` row by id and writes an `admin_logs` audit entry.
51. `POST /api/v1/admin/users`: creates `admin_users` with Go-generated bcrypt password hash and writes an `admin_logs` audit entry.
52. `PUT /api/v1/admin/users/{user_id}`: updates non-password `admin_users` profile/status fields, prevents disabling the current operator, and writes an `admin_logs` audit entry.
53. `POST /api/v1/admin/users/{user_id}/toggle-status`: toggles `admin_users.is_active`, prevents toggling the current operator, and writes an `admin_logs` audit entry.
54. `POST /api/v1/admin/users/{user_id}/reset-password`: resets one `admin_users.password_hash` with Go-generated bcrypt hash and writes an `admin_logs` audit entry.
55. `DELETE /api/v1/admin/users/{user_id}`: soft-deletes by default via `is_active=false`, supports `soft_delete=false` for hard delete, prevents deleting the current operator, and writes an `admin_logs` audit entry.
56. `POST /api/v1/admin/users/batch-status`: updates `admin_users.is_active` for normalized user ids, skips the current operator, reports not-found ids, and writes an `admin_logs` audit entry.
57. `POST /api/v1/admin/users/batch-delete`: soft-deletes by default, supports `soft_delete=false`, skips the current operator, reports not-found ids, and writes an `admin_logs` audit entry.
58. `POST /api/v1/admin/users/batch-reset-password`: resets password hashes for normalized user ids with Go-generated bcrypt hash, skips the current operator, reports not-found ids, and writes an `admin_logs` audit entry.
59. `GET /api/v1/admin/users/export-csv`: exports filtered `admin_users` rows as UTF-8 BOM CSV via Go-native read model and writes a `user_export_csv` audit entry.
60. `PUT /api/v1/admin/profile`: updates the current active admin user's email, full name, phone, or avatar by JWT subject and writes an `admin_logs` audit entry.
61. `PUT /api/v1/admin/profile/password`: verifies the current password, writes a Go-generated bcrypt password hash, and writes an `admin_logs` audit entry.
