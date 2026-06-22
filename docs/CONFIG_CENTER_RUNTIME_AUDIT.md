# GraphInsight 配置中心运行态审计

更新时间：2026-06-22

## 结论

当前配置中心的主数据模型应统一为：

1. `ai_service`：问答、建图抽取、模型目录、推理档位。
2. `embedding`：仅在嵌入模型和 AI 服务不同时覆盖 provider/base_url/api_key/model/dimension/batch_size。
3. `vector_store`：Milvus 等向量库连接。
4. `document_parser`：native / MinerU 解析器配置。
5. `retrieval`：keyword/vector/hybrid/graph_hybrid 召回策略，以及 RRF 后二阶段 reranker 配置。
6. `neo4j`、`nl2cypher`：专项运行配置。

历史 `openai` 命名不再作为主入口使用。Go 侧旧别名已经移除；前端、文档主路径和 Python 运行态都只使用 `ai_service` / `ai-service`。

## 本轮发现的问题

1. 图谱实体/关系抽取器读取启动环境变量里的旧模型名，没有读取配置中心 `ai_service.model`，导致网关实际支持 `gpt-5.5` 时仍先用旧 `qwen-flash` 校验并触发“模型不可用，已自动切换”。
2. 前端模型目录曾调用 `/api/v1/admin/config/openai/models`，主路径命名和当前 `ai_service` 配置域不一致。
3. Python 旧 `ConfigService` 仍暴露 `get_openai_config`、`test_openai_connection`、`get_available_openai_models`，容易让后续代码重新绕回旧命名。
4. 部分 Python runtime config 会被配置中心空字符串遮蔽环境变量默认值，典型风险包括 MinerU `base_url`、Milvus `uri/collection`、Neo4j `uri/user/database`。
5. 文档和 schema 示例仍出现 `openai` 分类，容易误导后续开发继续新增旧字段。
6. 本地 Neo4j Bolt 地址使用 `127.0.0.1` 时可能被其他本机进程抢占 IPv4 端口，导致后端握手超时；Docker Neo4j 的 Bolt 监听在当前环境可通过 `localhost:7687` 正常访问。

## 已完成收敛

1. 图谱抽取器改为读取配置中心 `ai_service` 运行时配置，并按配置变化重建 OpenAI-compatible client。
2. 模型目录主路径改为 `GET /api/v1/admin/config/ai-service/models`；前端和 Go 测试已切换到新路径。
3. Go 旧 `openai` 路由别名和 Python 旧 openai 兼容方法已删除，并在测试中加静态/路由守卫。
4. `runtime_config.py` 对 `document_parser`、`vector_store`、`neo4j` 改为“空字符串不遮蔽默认值”。
5. 配置 schema 示例和企业交付文档已改用 `ai_service` / `ai-service` 命名。
6. 开发启动脚本的默认 `NEO4J_URI` 已改为 `bolt://localhost:7687`，并同步修正当前配置库 `neo4j.uri`，避免继续误连被占用的 `127.0.0.1:7687`。
7. DocQA reranker 已从“仅配置开关”升级为真实二阶段重排能力，运行字段包括 `rerank_enabled`、`rerank_model`、`rerank_base_url`、`rerank_endpoint_path`、`rerank_top_n`、`rerank_timeout_seconds`；`rerank_base_url` 留空时复用 AI 服务网关，API key 复用 `ai_service.api_key`。

## 已移除的历史别名

1. `GET /api/v1/admin/config/openai/models`
2. `GET /api/v1/admin/config/openai/all`
3. `POST /api/v1/admin/config/test/openai`

上述入口现在应返回 Go-owned 404。新代码、前端和文档主路径不得继续使用。

## 后续建议

1. 把配置中心字段白名单下沉到 Go/Python 共享的契约文档或生成文件，减少前端、Go、Python 三处手写字段漂移。
2. 给 `document_parser`、`embedding`、`vector_store` 增加统一“有效运行配置”只读接口，前端展示时区分“数据库显式保存值”和“运行时继承值”。
