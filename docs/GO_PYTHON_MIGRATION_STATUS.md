# GraphInsight Go-Python 后端迁移当前完成度

更新时间：2026-06-13

## 1. 先回答核心问题

如果问题是：

1. `之前说后端改为 Go，但是模型处理还是 Python，这件事完成了吗？`

当前最准确的回答是：

1. `方向已经确定并部分落地`
2. `默认外部入口切到 Go 这件事已基本完成`
3. `模型处理、文档解析、问答能力保留在 Python 这件事已明确且在执行`
4. `所有 AI 能力逻辑都迁到 Go` 这件事**没有计划也没有必要完成**

一句话结论：

1. `我们已经完成了“Go 编排 + Python AI 能力层”的主架构切换`
2. `但还没有完成“所有能力都在 Go 内部执行”`

## 2. 当前长期架构已经明确

当前项目执行口径已经不是：

1. `Go 最终完全替代 Python`

而是：

1. `Go 负责默认外部入口、权限、契约、控制面、审计与交付能力`
2. `Python 负责 AI 能力、文档解析、抽取、问答和模型生态适配`

相关边界说明见：

1. [docs/BACKEND_BOUNDARY_FINAL.md](/home/yuanhuan/GraphInsight/docs/BACKEND_BOUNDARY_FINAL.md)
2. [docs/GO_PYTHON_HYBRID_BOUNDARY.md](/home/yuanhuan/GraphInsight/docs/GO_PYTHON_HYBRID_BOUNDARY.md)
3. [docs/GO_DEFAULT_ENTRY_EXECUTION_PLAN.md](/home/yuanhuan/GraphInsight/docs/GO_DEFAULT_ENTRY_EXECUTION_PLAN.md)
4. [docs/GO_PYTHON_DELIVERY_CLOSURE_CHECKLIST.md](/home/yuanhuan/GraphInsight/docs/GO_PYTHON_DELIVERY_CLOSURE_CHECKLIST.md)

## 3. 当前完成度总览

按当前仓库状态，建议把迁移进度分成三类理解：

1. `A 类：Go 已原生接手`
2. `B 类：Go 已成为默认入口，但仍调用 Python 执行能力`
3. `C 类：仍主要由 Python 直接主导`

## 3.1 最新联调结论（2026-06-10）

本轮又补了一次真实运行态收尾，结论如下：

1. Go 默认响应体现在继续固定为统一信封：即使 `data=null` 也会显式返回 `data` 字段，前端统一解析不再因为字段缺失报错。
2. 浏览器联调与 Node 侧 E2E 地址语义已经分开固定：
   - 浏览器前端可使用 `VITE_API_BASE_URL=same-origin`
   - 脚本和 Playwright Node 侧直连后端使用 `ADMIN_BASE_URL` / `E2E_API_BASE_URL`
3. Go 本地默认 CORS 已包含 `http://localhost:1234` 与 `http://127.0.0.1:1234`，可覆盖当前已验证的浏览器 QA 端口。
4. Playwright 配置已修复 `E2E_BASE_URL` 自定义端口时的启动错位问题，不再出现“前端起在 4173、测试等待 1234”的超时。
5. 前端遗留重复服务 `frontend/src/services/adminApi.ts` 已确认无引用并删除，管理后台统一只保留 `frontend/src/services/adminService.ts` 作为实际入口。
6. Linux / Windows 发布验收包装脚本也已对齐这套语义：浏览器默认 `VITE_API_BASE_URL=same-origin`，Node 侧直连继续使用 `ADMIN_BASE_URL` / `E2E_API_BASE_URL`。
7. 数据库迁移回滚能力已继续扩大：`backend/admin/migrate_job_worker_lease.py`、`backend/admin/migrate_admin_log_audit_fields.py`、`backend/admin/migrate_add_login_count.py`、`backend/admin/migrate_add_is_encrypted.py`、`backend/admin/migrate_rbac_core.py`、`backend/admin/migrate_jobs_table.py`、`backend/admin/migrate_qa_traces_table.py` 已支持 `--dry-run` 与 `--action rollback`，并通过隔离 SQLite 单测验证。
8. 数据库迁移回滚现已具备统一烟测入口：`backend/tests/run_migration_rollback_smoke.py` 会串行执行全部迁移回滚单测，发布验收脚本也已挂接该入口。
9. 当日复验通过：
   - `frontend npx tsc --noEmit -p tsconfig.json`
   - `frontend npm run build`
   - `go test ./internal/httpserver ./internal/config`
   - `backend/tests/run_unified_boundary_guards.py`
   - `backend/tests/run_backend_smoke_suite.py --include unified_mode --include go_orchestrated --include documents --include jobs_api --include reindex_obs --include qa_traces --include qa_cost_unit`
   - `frontend/tests/run_admin_e2e.sh`，结果 `2 passed, 1 skipped`
   - `backend/tests/run_release_acceptance.sh --skip-boundary-guards --skip-backend-smoke --skip-perf-probe`，结果 `ACCEPTANCE_SUMMARY failures=0`
   - `backend/tests/run_release_acceptance.sh --skip-perf-probe`，结果 `ACCEPTANCE_SUMMARY failures=0`
   - `backend/tests/check_migrate_job_worker_lease_rollback_unit.py`，结果 `MIGRATE_JOB_WORKER_LEASE_ROLLBACK_UNIT_OK`
   - `backend/tests/check_migrate_admin_log_audit_fields_rollback_unit.py`，结果 `MIGRATE_ADMIN_LOG_AUDIT_FIELDS_ROLLBACK_UNIT_OK`
   - `backend/tests/check_migrate_add_login_count_rollback_unit.py`，结果 `MIGRATE_ADD_LOGIN_COUNT_ROLLBACK_UNIT_OK`
   - `backend/tests/check_migrate_add_is_encrypted_rollback_unit.py`，结果 `MIGRATE_ADD_IS_ENCRYPTED_ROLLBACK_UNIT_OK`
   - `backend/tests/check_migrate_rbac_core_rollback_unit.py`，结果 `MIGRATE_RBAC_CORE_ROLLBACK_UNIT_OK`
   - `backend/tests/check_migrate_jobs_table_rollback_unit.py`，结果 `MIGRATE_JOBS_TABLE_ROLLBACK_UNIT_OK`
   - `backend/tests/check_migrate_qa_traces_table_rollback_unit.py`，结果 `MIGRATE_QA_TRACES_TABLE_ROLLBACK_UNIT_OK`
   - `backend/tests/run_migration_rollback_smoke.py`，结果 `SUMMARY total=7 failed=0`

## 3.2 最新交付收口结论（2026-06-13）

本轮重点不是继续扩功能，而是把后端边界改造成可 CI、可复验、可继续开发的状态：

1. CI 后端边界编译清单已同步当前真实文件，移除已退役 Python `documents` / `graph_build` 路由文件引用。
2. Python internal `nl2cypher` 边界守卫已去除真实 AI Key 成功依赖，只验证 header、trace、空参数与 capability 响应信封，避免无模型配置环境误报失败。
3. 新增 [docs/BACKEND_BOUNDARY_FINAL.md](/home/yuanhuan/GraphInsight/docs/BACKEND_BOUNDARY_FINAL.md)，冻结当前 Go / Python 职责边界。
4. 本地复验通过：
   - `backend/tests/run_unified_boundary_guards.py`：`SUMMARY total=12 failed=0`
   - `go test ./internal/httpserver ./internal/config`
   - `frontend npm run build`
   - `frontend/tests/e2e/admin-core.spec.ts`：`4 passed`

## 4. A 类：Go 已原生接手

这些能力当前已经在 Go 内有明确 Owner：

1. `GET /health`
2. `POST /api/query`
3. `POST /api/expand`
4. `GET /api/node/{id}`
5. Go 原生 `Neo4j` 连接与图查询执行
6. 基础 HTTP 中间件、统一响应、部分业务鉴权守卫
7. 编排指标、幂等缓存、上游依赖健康暴露
8. Go 控制面入口注册与后台模块 Owner 显式标记

主要代码位置：

1. [go-backend/internal/httpserver/server.go](/home/yuanhuan/GraphInsight/go-backend/internal/httpserver/server.go)
2. [go-backend/internal/httpserver/handlers.go](/home/yuanhuan/GraphInsight/go-backend/internal/httpserver/handlers.go)
3. [go-backend/internal/graph/service.go](/home/yuanhuan/GraphInsight/go-backend/internal/graph/service.go)
4. [go-backend/internal/authz/client.go](/home/yuanhuan/GraphInsight/go-backend/internal/authz/client.go)

说明：

1. 这部分不再只是“透传 Python”
2. Go 已经直接连 Neo4j 并执行查询

## 5. B 类：Go 已成为默认入口，但能力执行仍依赖 Python

这些链路当前对外建议由 Go 暴露，但底层执行仍主要走 Python：

1. `POST /api/docqa`
2. `POST /api/docqa/deep-research`
3. `GET /api/docqa/health`
4. `POST /api/nl2cypher`

这部分在 Go 中已经有明确入口 owner，主要代码位置：

1. [go-backend/internal/httpserver/handlers.go](/home/yuanhuan/GraphInsight/go-backend/internal/httpserver/handlers.go)
2. [go-backend/internal/httpserver/docqa_native.go](/home/yuanhuan/GraphInsight/go-backend/internal/httpserver/docqa_native.go)
3. [go-backend/internal/httpserver/nl2cypher_native.go](/home/yuanhuan/GraphInsight/go-backend/internal/httpserver/nl2cypher_native.go)

说明：

1. 这里的目标不是把 AI 逻辑重写到 Go
2. 而是让 Go 接手：
   - 外部入口
   - 参数契约校验
   - 业务审计
   - 权限
   - 观测
   - 结果包装
3. Python 继续负责：
   - 文档解析
   - 建图执行
   - 问答与深度调研
   - 模型调用

这部分就是“Go 编排 + Python 能力层”的核心落地点。

补充：

1. `POST /api/graph/build` 已不再走 Go -> Python `/api/internal/graph/build` 公开主链路。
2. `DELETE /api/documents` 已不再走 Go -> Python `/api/internal/documents` 公开主链路。
3. 当前这些路径由 Go 原生创建任务或执行文件目录/图谱治理动作，并按需唤醒 Python worker。

补充说明：

1. `GET /api/documents`
2. `GET /api/documents/deleted`
3. `POST /api/documents/upload`
4. `DELETE /api/documents/{doc_id}`
5. `POST /api/documents/{doc_id}/restore`

已在 Go 侧原生承接文件目录读写、回收站元数据、单文档删除与恢复，不再转发 Python 内部能力接口。

## 6. C 类：当前仍主要由 Python 主导

以下能力目前还没有完成 Go 原生实现收口：

1. `nl2cypher` 的核心推理与提示词策略仍由 Python 主导
2. 模型 provider 适配与运行时策略
3. 文档解析、切分、抽取核心实现
4. `docqa`、`deep-research` 核心算法与提示词策略

说明：

1. Go 已移除 `/api/v1` 整段代理兜底，admin 模块已全部进入 Go 明确 Owner 范围
2. 当前后台模块已经由 Go 显式注册并完成入口语义收口：
   - `auth`
   - `config`
   - `monitor`
   - `jobs`
   - `qa-traces`
   - `logs`
   - `rbac`
   - `users`
   - `profile`
3. 管理后台数据面已主要由 Go 读写 `admin_*` 表，不再依赖 Python public admin surface
4. `nl2cypher` 已进入“Go 入口稳定编排、Python 推理执行”模式，但尚未 Go 原生化
5. 问答入口族当前已固定为 Go 入口校验/审计 + Python capability 执行，说明 Go/Python 的职责分工已从“入口切换”进入“边界冻结与交付收尾”阶段
6. Python `/api/internal/documents*` 与 `/api/internal/graph/build` 已从默认 runtime、守护测试与诊断脚本一并退役，不再保留为“诊断专用后门”；退役的 `api/routes/graph_build.py` 源码实现也已删除。
7. Python capability / worker / QA trace / monitor 执行路径已把运行态配置读取从 `admin.services.config_service` 抽离到独立 runtime helper，避免执行层继续反向耦合 Go-owned 控制面服务。
8. `docqa` capability route 的 QA trace 写入已改走 `services/qa_trace_runtime.py`，路由层不再直接 import admin QA trace schema/service。
9. Python internal capability route 的 DB dependency 已改走 `services/runtime_db.py`，`api/routes/*` 不再直接 import `admin.database`；残留 admin schema/service/config 访问集中在 runtime adapter 文件中。
10. 已退役的 Python documents route 源码实现已删除，文档治理 public owner 固定在 Go，Python 不再在 `api/routes` 下保留未挂载的 documents route 模块。
11. Python job worker 的具体能力执行已抽到 `services/job_runtime.py`：`admin/services/job_service.py` 保留任务状态机、lease、heartbeat、retry 和审计，不再直接持有 build_graph / clear_kb / reindex 的执行实现。
12. Python admin endpoint 源码层已进一步收口：`admin/api/endpoints/{auth,config,logs,monitor,profile,qa_traces,rbac,users}.py` 当前只保留退役标记，不再保留任何未挂载 public handler；`jobs.py` 只保留 `/api/internal/jobs/wake` 所需的最小内部能力实现。

关键证据位置：

1. [go-backend/internal/httpserver/handlers.go](/home/yuanhuan/GraphInsight/go-backend/internal/httpserver/handlers.go)
2. [backend/main.py](/home/yuanhuan/GraphInsight/backend/main.py)
3. [backend/api/routes/doc_qa.py](/home/yuanhuan/GraphInsight/backend/api/routes/doc_qa.py)
4. [backend/api/routes/nl2cypher.py](/home/yuanhuan/GraphInsight/backend/api/routes/nl2cypher.py)

## 7. 默认入口切换这件事，完成到哪了

如果单独看“Go 是否已经成为默认外部入口”，当前完成度已经比较高。

已完成的事实包括：

1. 文档口径已经改成：
   - Go `8081` 是默认外部入口
   - Python `8001` 是内部能力层
2. 本地 smoke / preflight 默认验证路径已经切到 Go
3. 前端默认也在朝 Go 收口
4. Go `/health` 已能展示：
   - `neo4j`
   - `python_backend`
   - `authz`
   - `orchestrator`
   的状态

相关文档：

1. [README.md](/home/yuanhuan/GraphInsight/README.md)
2. [backend/README.md](/home/yuanhuan/GraphInsight/backend/README.md)
3. [docs/GO_DEFAULT_ENTRY_EXECUTION_PLAN.md](/home/yuanhuan/GraphInsight/docs/GO_DEFAULT_ENTRY_EXECUTION_PLAN.md)
4. [docs/DEVELOPMENT_ENVIRONMENT_MODES.md](/home/yuanhuan/GraphInsight/docs/DEVELOPMENT_ENVIRONMENT_MODES.md)

但还没完全结束，因为：

1. CI 远端环境的完整 `release-acceptance` 仍建议再复跑一轮，确认新增迁移回滚烟测与远端环境一致
2. 容量上限与长稳 soak 测试还没收尾
3. 当前入口校验重点已转为运行态回归、文档同步、容量验证与交付收尾

## 8. 如果按“是否完成”打分

为了方便你判断阶段状态，我给一个偏保守的工程评分：

1. `架构方向统一`：`9/10`
2. `Go 成为默认外部入口`：`9/10`
3. `Go 原生图查询能力`：`8/10`
4. `Go 编排 Python 能力链路`：`9/10`
5. `后台控制面 Go Owner 收口`：`9/10`
6. `Python 完全退出公共业务入口`：`9/10`

综合判断：

1. `主路线已经跑通`
2. `但还没有到“CI、发布回滚和全部交付项都关账”的程度`

## 9. 当前最准确的项目状态

现在更准确的说法应该是：

1. `GraphInsight 已从“Python 单后端”进入“Go 默认入口 + Python AI 能力层”的混合架构阶段`
2. `Go 已经不是实验性旁路，而是正式外部入口`
3. `Python 也不是待下线遗留，而是长期保留的 AI 能力层`
4. `控制面入口 Owner 收口已基本完成`
5. `尚未完成的重点转为 CI 远端复跑、容量/soak、回滚演练与 Go 原生化深化`

## 9.1 当前代码收口结果

截至 2026-06-07，Go 路由层已经完成一轮边界显式化收口：

1. 图查询类路由单独归入 `Go 原生` 注册逻辑
2. 文档 / 建图 / 问答类路由已按职责拆开：`documents` 与 `graph/build` 进入 Go 原生/任务编排逻辑，`docqa`/`nl2cypher` 保持 Go 编排 Python 能力逻辑
3. 所有已知 admin 模块已单独归入 `Go 原生控制面入口`
4. `/api/v1/*` 不再保留兜底兼容；`/api/media/*` 已改由 Go 原生承接，对外不再依赖 Python 代理入口。
5. Go 响应头新增 `X-GraphInsight-Route-Owner`，用于标记当前请求由谁负责：
   - `go-native`
   - `go-orchestrator`
6. `/api/media/*`、`/api/client-logs`、`/api/proxy-media`、`/api/proxy-image`、`/api/video-thumbnail` 已改为 Go 原生承接；Python 侧对应公开业务路由模块已删除，不再属于默认 compat runtime 或源码布局。

对应代码位置：

1. [go-backend/internal/httpserver/handlers.go](/home/yuanhuan/GraphInsight/go-backend/internal/httpserver/handlers.go)
2. [go-backend/internal/httpserver/orchestrator_handlers.go](/home/yuanhuan/GraphInsight/go-backend/internal/httpserver/orchestrator_handlers.go)
3. [go-backend/internal/httpserver/response.go](/home/yuanhuan/GraphInsight/go-backend/internal/httpserver/response.go)

这样做的目的不是新增业务能力，而是：

1. 先把 Owner 看清楚
2. 避免后续继续在同一个文件里把 `Go 原生`、`Go 编排`、`Python 遗留代理` 写成一团
3. 为后续逐步用 Go 原生实现替换 Python 上游做准备
4. 把“拆分是否完成”从主观判断变成可验证的路由 Owner 事实

## 9.2 当前可以如何下结论

如果问题是：

1. `Go / Python 的职责拆分是不是已经收尾了？`

当前建议直接回答：

1. `主架构拆分已经基本收尾`
2. `入口 Owner 收口基本完成`
3. `但 Go 原生化、E2E 与交付项还没有收尾`

换句话说：

1. `拆分方向和边界，不再是主要风险`
2. `剩余工作主要是工程收尾，不是架构摇摆`

## 10. 下一步最值得做什么

如果继续按当前主线推进，优先级建议如下：

1. 完成“上传文档 -> 建图 -> 问答 -> 追踪 -> 删除”的前端主流程 E2E
2. 继续将控制面从“Go 原生入口已收口”演进为“更多控制面细节完全 Go 原生实现”
3. 继续减少前端、脚本和开发者对 Python 直连路径的依赖
4. 在 CI 远端复跑 `backend-unified-guards`、Go tests 与发布验收手动入口
5. 基于当前边界清单继续做容量/soak 与回滚演练

## 11. 推荐表述

以后如果你要对外或对团队说明当前状态，建议直接用下面这句：

1. `我们不是把 Python 后端整体改写成 Go，而是已经完成主架构切换：Go 负责默认外部入口与业务编排，Python 负责模型、问答、抽取等 AI 能力层；当前仍在继续收口控制面与剩余链路。`
