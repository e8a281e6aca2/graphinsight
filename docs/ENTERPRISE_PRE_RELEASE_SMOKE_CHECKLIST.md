# GraphInsight 发布前固定 Smoke 清单

更新时间：2026-06-13

## 1. 适用范围

以下任一场景发布前，必须执行本清单：

1. 后端业务 API 变更，尤其是文档上传、建图、问答、删除相关改动。
2. LLM / 模型网关 / Neo4j / 管理后台任务中心相关改动。
3. 企业级后台版本发布，且需要确认主业务链路可演示、可回归。

## 2. 发布阻断项

以下任一项失败，当前版本不得发布：

1. `/health` 健康检查失败。
2. `backend/tests/run_backend_preflight.ps1` 返回非 `0`。
3. `docqa_full_chain` 未输出 `DOCQA_FULL_CHAIN_OK`。
4. 问答追踪未写入成功记录，或链路详情不可查询。
5. 删除校验失败，导致测试文档未被清理。

## 3. 执行前准备

1. 后端依赖已安装，Linux 开发环境固定使用 `backend/.venv/bin/python`。
2. 管理员凭证已准备：
   - 优先：`ADMIN_TOKEN`
   - 备选：`ADMIN_EMAIL` + `ADMIN_PASSWORD`
3. 本地 Neo4j、管理库、模型网关已按当前发布基线启动。
4. 若使用 `scripts/dev-backend.sh` 启动 unified 后端，必须确认 `logs/dev/backend.env` 已写出 `ADMIN_DATABASE_URL`，且默认指向本地 Docker PostgreSQL `127.0.0.1:5434/graphinsight_admin`。
5. 禁止在命令输出、截图、文档中记录真实 token、密码、API key。
6. 若本地同时存在 Neo4j Desktop、Docker Neo4j、历史端口映射，发布前必须确认当前 `7474/7687` 对应的实例与运行态配置一致；默认 unified 开发态可通过 Go `/health` 中的 `neo4j.config_source` 判断来源。

## 4. 固定执行顺序

补充说明：

1. `.github/workflows/ci.yml` 已固化 `backend-unified-guards`，用于默认门禁执行 `backend/tests/run_unified_boundary_guards.py`，覆盖 Python 边界守卫与内部 capability unit checks。
2. `.github/workflows/ci.yml` 已提供手动 `backend-release-smoke`，复用 `backend/tests/run_release_acceptance.sh --skip-frontend-e2e --skip-perf-probe` 对外部 Go 网关执行本清单对应的后端发布级 smoke。
3. CI 与本地执行口径保持一致：后端 Python 检查统一使用 `backend/.venv`。

### 4.1 一键预检

推荐在 Windows PowerShell 执行：

```powershell
powershell -ExecutionPolicy Bypass -File backend/tests/run_backend_preflight.ps1
```

Linux / WSL 推荐入口：

```bash
backend/tests/run_release_acceptance.sh --skip-frontend-e2e --skip-perf-probe
```

若本机 `8081` 被非 GraphInsight 进程占用，统一启动脚本可自动回退到可用端口；验收时必须读取 `logs/dev/runtime.env` 中的 `GO_BASE_URL`。隔离端口也可以显式指定：

```powershell
powershell -ExecutionPolicy Bypass -File backend/tests/run_backend_preflight.ps1 -BaseUrl http://127.0.0.1:18081
```

验收标准：

1. 输出包含 `PYTHON_BACKEND_START_OK` 或 `PYTHON_BACKEND_REUSE`。
2. 输出包含 `GO_GATEWAY_START_OK` 或 `GO_GATEWAY_REUSE`。
3. 输出包含 `GO_SMOKE end exit_code=0`。
4. 输出包含 `SMOKE_SUITE end exit_code=0`。
5. `SUMMARY total=` 中 `failed=0`。
6. 若使用 Go 隔离端口回归，还应确认 Go `/health` 中 `neo4j.connected=true`，避免出现“编排链路可用但 Go 原生图查询凭据失配”的假阳性。
7. 若走 Linux / WSL 发布验收入口，还应确认输出包含 `ACCEPTANCE_STEP_OK name=unified-boundary-guards` 与 `ACCEPTANCE_STEP_OK name=backend-smoke`。
8. 若走当前统一启动脚本，还应确认 `logs/dev/runtime.env` 中记录的 `GO_BASE_URL` 与实际 smoke 使用的 `ADMIN_BASE_URL` 一致。

### 4.2 主业务链路定向复核

如果本次发布涉及上传、建图、问答、追踪、删除、模型切换、问答稳定性，必须单独复跑：

```bash
backend/.venv/bin/python backend/tests/run_backend_smoke_suite.py --include docqa_full_chain
```

或在定位问题时直接执行：

```bash
backend/.venv/bin/python backend/tests/check_docqa_full_chain.py
```

验收标准：

1. 输出包含 `UPLOAD_STATUS 200`
2. 输出包含 `JOB_CREATE_STATUS 200`
3. 输出包含 `JOB_FINAL succeeded`
4. 输出包含 `DOCQA_STATUS 200`
5. 输出包含 `DOCQA_TRACE_ID`
6. 输出包含 `TRACE_STATUS success`
7. 输出包含 `DELETE_STATUS 200`
8. 输出包含 `DOCQA_FULL_CHAIN_OK`

## 5. 主链路验收解释

固定目标链路：

1. 上传文档
2. 发起建图任务
3. 等待任务完成
4. 进入问答
5. 验证问答追踪
6. 删除文档并确认删除结果

每一步的最小通过标准：

1. 上传文档：
   - 接口返回 200
   - 新上传文件可在文档列表中找到
2. 建图任务：
   - 成功创建 `job_id`
   - 终态为 `succeeded`
3. 问答：
   - 返回 200
   - 非空回答
4. 问答追踪：
   - 可通过 `trace_id` 在 `/api/v1/admin/qa-traces` 列表中检索
   - 详情接口可查询
   - `status=success`
   - `model` 应与当前发布配置中的 QA 模型一致
   - 若本次发布目标是验证 LLM 正常生成，则 `generation_snapshot.mode` 应为 `llm_success`
5. 删除文档：
   - 删除接口返回 200
   - 烟测文档不再出现在列表中
   - 若启用图谱清理，删除后校验结果应返回一致

## 6. 发布记录要求

在发布单或 `docs/ENTERPRISE_RELEASE_TEMPLATE.md` 中至少记录以下事实：

1. 执行日期与执行人
2. 执行命令
3. `run_backend_preflight.ps1` 结果
4. `docqa_full_chain` 结果
5. 最新成功链路的 `trace_id`
6. 若涉及任务中心，记录对应 `job_id`
7. 若失败，记录失败步骤、报错摘要、是否阻断发布

建议记录格式：

```text
- preflight: pass / fail
- docqa_full_chain: pass / fail
- latest_trace_id: <masked-or-internal-record>
- latest_job_id: <number>
- notes: <short factual summary>
```

## 7. 失败时的处理顺序

1. 先看 `/health` 是否正常。
2. 再看 `run_backend_preflight.ps1` 的 stdout/stderr。
3. 若失败集中在问答链路，单独执行 `check_docqa_full_chain.py`。
4. 若追踪记录异常，检查 `/api/v1/admin/qa-traces` 列表与详情接口。
5. 若模型生成异常，优先确认当前 QA 模型、网关可达性、代理配置与 `HTTP_CLIENT_TRUST_ENV`。
6. 若 Go `/health` 里 `neo4j.connected=false`，优先检查：
   - 当前 `7474/7687` 实际由哪个实例占用
   - `backend/.env` 与运行中 Neo4j 的真实凭据是否一致
   - 是否仍有旧 Python / Go 进程持有历史有效连接，导致新进程与旧进程表现不一致

## 8. 当前固定基线说明

截至 2026-06-07，已确认以下链路可作为发布前回归基线：

1. `backend/tests/run_backend_preflight.ps1`
2. `go-backend/scripts/smoke_orchestrated_routes.py`
3. `backend/tests/run_backend_smoke_suite.py`
4. `backend/tests/check_docqa_full_chain.py`
5. Go 隔离端口预检样例：
   `run_backend_preflight.ps1 -BaseUrl http://127.0.0.1:18085 -Include documents`
6. Go 隔离端口完整主链路样例：
   `run_backend_preflight.ps1 -BaseUrl http://127.0.0.1:18084 -Include docqa_full_chain -KeepServer`
7. 2026-05-26 实跑通过完整后端 smoke：
   `backend/tests/run_backend_smoke_suite.py --base-url http://127.0.0.1:18081`，验收重点为 `SUMMARY ... failed=0`
8. 2026-06-06 新增默认 unified 运行态定向 smoke：
   `backend/tests/run_backend_smoke_suite.py --include dev_runtime_defaults --include go_orchestrated --include python_public_removed --include unified_mode`，`SUMMARY total=4 failed=0`
9. 2026-06-06 扩大后的 unified 控制面 smoke：
   `backend/tests/run_backend_smoke_suite.py --include dev_runtime_defaults --include go_orchestrated --include python_public_removed --include authz --include unified_mode --include jobs_api`，`SUMMARY total=6 failed=0`
10. 2026-06-07 默认 unified 深链路 smoke 基线：
   `backend/tests/run_backend_smoke_suite.py` 当前默认包含 `dev_runtime_defaults`、`migration_cleanup_guards`、`go_orchestrated`、`nl2cypher_contract`、`nl2cypher_post_contract`、`nl2cypher_audit_contract`、`docqa_post_contract`、`docqa_audit_contract`、`deep_research_post_contract`、`deep_research_audit_contract`、`docqa_health_contract`、`python_public_removed`、`authz`、`unified_mode`、`documents`、`jobs_api`、`reindex_obs`、`qa_traces`、`qa_cost_unit`、`docqa_full_chain` 共 20 个 case，验收重点为 `failed=0`。
11. 2026-06-07 问答入口族定向 smoke：
   `backend/tests/run_backend_smoke_suite.py --include go_orchestrated --include docqa_health_contract --include docqa_post_contract --include docqa_audit_contract --include deep_research_post_contract --include deep_research_audit_contract --include qa_traces`，`SUMMARY total=7 failed=0`
12. 2026-05-26 实跑通过前端业务 E2E：
   `frontend/tests/run_admin_e2e.ps1 -AdminBaseUrl http://127.0.0.1:18081 -E2ESpec business-docqa-flow.spec.ts`，`1 passed`
13. 2026-06-13 交付收口复验：
   - CI 后端边界编译清单已移除退役 `documents` / `graph_build` Python 路由文件引用。
   - `backend/tests/run_unified_boundary_guards.py`：`SUMMARY total=12 failed=0`
   - `go test ./internal/httpserver ./internal/config`：通过
   - `frontend npm run build`：通过
   - `frontend/tests/e2e/admin-core.spec.ts`：`4 passed`

后续若主业务链路发生变化，必须同步更新本文件，而不是只修改口头流程。
