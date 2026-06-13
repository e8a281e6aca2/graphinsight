# GraphInsight Backend Boundary Final

更新时间：2026-06-13

本文档冻结当前 Go / Python 后端职责边界，作为后续开发、验收和代码清理的默认依据。

## 1. 结论

1. Go 是默认外部入口。
2. Python 是内部能力层，不再作为公开业务或公开管理入口。
3. 前端、E2E、smoke、发布验收默认访问 Go。
4. 本地开发管理库默认使用 Docker PostgreSQL：`127.0.0.1:5434/graphinsight_admin`。
5. Neo4j 配置默认走 `auto`，优先读取 admin DB 配置，缺失时按本地环境变量回退。

## 2. Go 负责

Go 负责所有外部请求入口、认证鉴权、控制面读写、业务审计、统一响应、路由 owner 标记和对 Python capability 的编排。

Go 原生外部入口：

1. `GET /health`
2. `POST /api/query`
3. `POST /api/expand`
4. `GET /api/node/{node_id}`
5. `GET /api/graph/schema`
6. `GET /api/documents`
7. `GET /api/documents/deleted`
8. `POST /api/documents/upload`
9. `DELETE /api/documents/{doc_id}`
10. `POST /api/documents/{doc_id}/restore`
11. `DELETE /api/documents`
12. `POST /api/graph/build`
13. `GET /api/nl2cypher/examples`
14. `GET /api/nl2cypher/status`
15. `/api/media/**`
16. `/api/client-logs`
17. `/api/proxy-media`
18. `/api/proxy-image`
19. `/api/video-thumbnail`

Go 原生管理控制面：

1. `/api/v1/admin/auth/*`
2. `/api/v1/admin/config*`
3. `/api/v1/admin/monitor*`
4. `/api/v1/admin/jobs*`
5. `/api/v1/admin/qa-traces*`
6. `/api/v1/admin/logs*`
7. `/api/v1/admin/rbac*`
8. `/api/v1/admin/users*`
9. `/api/v1/admin/profile*`

说明：

1. `GET /api/v1/admin/auth/me` 是当前用户信息正式入口。
2. `GET /api/v1/admin/auth/profile` 仅保留为历史兼容别名，新代码不得继续使用它。
3. 未知 `/api/v1/admin/*` 由 Go 返回 Go-owned `404`。
4. 未知非 admin `/api/v1/**` 不再代理到 Python。

## 3. Go 编排 Python

以下公开入口由 Go 接收、校验、鉴权、审计，再调用 Python internal capability 执行核心 AI 能力：

1. `POST /api/docqa` -> `POST /api/internal/docqa`
2. `POST /api/docqa/deep-research` -> `POST /api/internal/docqa/deep-research`
3. `GET /api/docqa/health` -> `GET /api/internal/docqa/health`
4. `POST /api/nl2cypher` -> `POST /api/internal/nl2cypher`

Go 调用 Python business capability 时必须带：

1. `X-Go-Orchestrator: graphinsight-go`
2. `X-Trace-Id`

## 4. Python 保留

Python 默认只保留以下入口：

1. `GET /health`
2. `GET /docs`
3. `GET /redoc`
4. `POST /api/internal/docqa`
5. `POST /api/internal/docqa/deep-research`
6. `GET /api/internal/docqa/health`
7. `POST /api/internal/nl2cypher`
8. `POST /api/internal/jobs/wake`

Python 内部职责：

1. 文档解析、切分、抽取核心逻辑
2. DocQA / deep research 执行
3. NL2Cypher 推理执行
4. 模型 provider 与运行时策略适配
5. Python worker 执行 `admin_jobs`
6. QA trace 写入与运行态能力数据处理

## 5. Python 已退役

Python 不再挂载这些公开入口：

1. `/api/query`
2. `/api/expand`
3. `/api/node/*`
4. `/api/graph/schema`
5. `/api/documents*`
6. `/api/graph/build`
7. `/api/docqa*`
8. `/api/nl2cypher*`
9. `/api/media/**`
10. `/api/client-logs`
11. `/api/proxy-media`
12. `/api/proxy-image`
13. `/api/video-thumbnail`
14. `/api/v1/admin/*`

Python 也不再保留这些退役 internal 入口：

1. `/api/internal/documents*`
2. `/api/internal/graph/build`
3. `/api/internal/nl2cypher/examples`
4. `/api/internal/nl2cypher/status`

## 6. 本地运行标准

推荐启动：

```bash
scripts/dev-backend.sh up
```

默认地址：

1. Go：`http://127.0.0.1:8081`
2. Python：`http://127.0.0.1:8001`
3. PostgreSQL：`127.0.0.1:5434/graphinsight_admin`
4. Neo4j Bolt：`bolt://127.0.0.1:7687`

端口被占用时，统一启动脚本可以回退端口；实际地址必须以 `logs/dev/runtime.env` 为准。

## 7. 守卫与验收

每次修改后端边界，至少执行：

```bash
backend/.venv/bin/python backend/tests/run_unified_boundary_guards.py
go test ./internal/httpserver ./internal/config
```

涉及前端登录、路由守卫或管理后台入口时，还要执行：

```bash
cd frontend
npm run build
E2E_CHECK_UI_LOGIN=1 E2E_ADMIN_EMAIL=admin@example.com E2E_ADMIN_PASSWORD=Admin12345 node node_modules/@playwright/test/cli.js test tests/e2e/admin-core.spec.ts --project=chromium
```

当前固定复验记录（2026-06-13）：

1. `backend/tests/run_unified_boundary_guards.py`：`SUMMARY total=12 failed=0`
2. `go test ./internal/httpserver ./internal/config`：通过
3. `frontend npm run build`：通过
4. `frontend/tests/e2e/admin-core.spec.ts`：`4 passed`

## 8. 禁止事项

1. 不得恢复 Python public business routes 作为正式入口。
2. 不得恢复 Python public admin routes 作为正式入口。
3. 不得把前端新代码指向 Python `8001`。
4. 不得绕过 Go 鉴权直接调用 Python internal capability 做业务路径。
5. 不得把远程 PostgreSQL 写回默认开发配置。
6. 不得新增 Windows `backend/venv` 作为 Linux 开发默认环境。
