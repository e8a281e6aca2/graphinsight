# GraphInsight 文档解析与 MinerU 接入设计

更新时间：2026-06-20
状态：阶段 A/B 基础能力已落地，结构化 chunk 与后台治理待继续推进；知识发现上层设计见 `docs/KNOWLEDGE_DISCOVERY_PIPELINE_DESIGN.md`

## 1. 背景

GraphInsight 当前已经具备文档上传、建图、DocQA、Deep Research、QA trace、Milvus 向量索引与混合检索底座。
当前主要短板不在检索链路本身，而在上游文档解析质量。

如果 PDF 解析结果存在读序混乱、表格丢失、OCR 缺失、公式破坏或页眉页脚污染，后续的 chunk、实体抽取、图谱关系、向量索引和问答引用都会受到影响。

因此需要把“文档解析器”从 `DocumentGraphService` 内部的私有实现，升级为可配置、可观测、可回退的解析能力层。

## 2. 当前实现现状

当前解析入口已从 `backend/services/document_graph_service.py` 抽离到 `backend/services/document_parser.py`：

1. `NativeDocumentParser` 保留原有解析行为。
2. 支持后缀：`.txt`、`.md`、`.markdown`、`.csv`、`.json`、`.log`、`.docx`、`.pdf`。
3. 文本类文件直接读取 UTF-8。
4. JSON 会格式化为文本。
5. DOCX 使用 `python-docx` 提取段落文本。
6. PDF 优先使用 `pdfplumber`，失败后回退 `pypdf`。
7. `MinerUDocumentParser` 通过 HTTP multipart 调用独立 MinerU sidecar。
8. `DocumentParserManager` 支持 `provider=mineru` 时失败回退 `native`。
9. 解析结果被标准化为 `ParsedDocument / ParsedBlock` 后，当前仍使用固定 `max_chars=800`、`overlap=120` 的字符窗口切块。
10. chunk 后再执行实体抽取、关系抽取、Neo4j 写入与 Milvus 向量索引。

当前实现适合：

1. 可复制文本 PDF。
2. 简单 DOCX。
3. 纯文本、Markdown、CSV、JSON。

当前实现不适合：

1. 扫描 PDF。
2. 多栏版式。
3. 表格密集文档。
4. 公式、图表、图片内文字。
5. 页眉、页脚、脚注、页码清理。
6. 跨页段落与跨页表格。
7. 需要保留标题层级、页码、bbox、图片或表格结构的 RAG 场景。

## 3. MinerU 能解决什么

MinerU 是面向 LLM、RAG、Agent 工作流的文档解析工具。根据官方 README，MinerU 支持 PDF、图片、DOCX、PPTX、XLSX 输入，能够输出 Markdown、JSON 等结构化结果，并提供 CLI、FastAPI、Docker 等集成方式。

对 GraphInsight 有价值的能力包括：

1. 扫描件 OCR。
2. 多栏文本读序恢复。
3. 表格识别并输出 HTML / Markdown。
4. 公式识别并输出 LaTeX。
5. 图片、图表与图片描述提取。
6. 页眉、页脚、页码等噪声清理。
7. 标题层级、段落、列表等结构保留。
8. 适配更复杂的 PDF 与 Office 文档。

这类能力会直接提升：

1. chunk 语义完整度。
2. 向量召回质量。
3. 图谱实体/关系抽取质量。
4. QA 引用可信度。
5. 管理后台对解析失败的可诊断性。

## 4. 核心结论

建议把 MinerU 作为独立 sidecar 服务接入，而不是直接塞进当前 Python backend 的虚拟环境。

原因：

1. MinerU 依赖较重，可能包含 OCR、视觉模型、torch、模型权重和系统库。
2. 当前 Python backend 已承担 AI capability、任务 worker、Neo4j、Milvus、DocQA 等职责，不宜继续扩展重型文档视觉解析运行时。
3. sidecar 更容易独立升级、独立限流、独立分配 GPU/CPU、独立挂载模型缓存。
4. 失败时可以回退 native parser，不影响主后端可用性。
5. 后续如使用 `mineru-router` 或多 GPU 部署，不需要重构 GraphInsight 主服务。

推荐部署形态：

```text
Go 外部入口
  -> 创建建图/重解析任务
Python worker
  -> DocumentParser adapter
      -> native parser: pdfplumber / pypdf / python-docx
      -> mineru parser: HTTP 调用 MinerU API sidecar
  -> 标准化 ParsedDocument
  -> chunk
  -> Neo4j: Document / Chunk / Entity / Relation
  -> Milvus: chunk vectors
```

## 5. 目标架构

### 5.1 Parser Provider

新增解析器抽象：

```text
DocumentParser
  parse(path, options) -> ParsedDocument
```

第一阶段支持两个 provider：

1. `native`：当前内置解析逻辑。
2. `mineru`：调用 MinerU sidecar。

配置建议：

```text
DOCUMENT_PARSER_PROVIDER=native|mineru
DOCUMENT_PARSER_FALLBACK_PROVIDER=native|none
MINERU_BASE_URL=http://127.0.0.1:XXXX
MINERU_ENDPOINT_PATH=/file_parse
MINERU_FILE_FIELD=files
MINERU_TIMEOUT_SECONDS=300
MINERU_PARSE_MODE=auto|ocr|txt
MINERU_OUTPUT_FORMAT=markdown,json
MINERU_PARSER_VERSION=
PARSED_DOCUMENT_STORAGE_PATH=./parsed_documents
```

后台配置项已预留 `document_parser` 分类，Python runtime 会优先读取后台配置中心，缺失时回退环境变量。

### 5.2 标准化解析结果

GraphInsight 不应让业务层直接依赖 MinerU 原始 JSON。建议定义内部标准结构：

```text
ParsedDocument
  doc_id
  file_name
  parser_provider
  parser_version
  parse_mode
  text
  markdown
  blocks[]
  assets[]
  warnings[]
  raw_output_path
```

`blocks[]` 建议字段：

```text
ParsedBlock
  block_id
  type: title | paragraph | table | formula | image | list | code | unknown
  text
  markdown
  html
  page
  bbox
  parent_heading
  order
```

第一阶段可以只使用 `markdown/text`，但必须把 `raw_output_path` 和 `blocks` 预留出来，避免后续二次迁移。

当前实现说明：

1. `ParsedDocument` 已包含 `text`、`parser_provider`、`parser_version`、`parse_mode`、`blocks[]`、`warnings[]`、`raw_payload`、`raw_output_path`。
2. `ParsedBlock` 已包含 `text`、`block_type`、`heading_path`、`page_start`、`page_end`、`source_location`。
3. 建图时会按 `doc_id` 写入 `PARSED_DOCUMENT_STORAGE_PATH/{doc_id}/`，包含 `manifest.json`、`content.md`、`blocks.json`、`chunks.jsonl`、`structured_chunks.jsonl`、`document_profile.json`、`extraction_schema.json`，以及 MinerU 原始响应 `raw.json` 或 `raw.txt`。
4. `assets[]` 和独立表格/图片/公式节点尚未落地，等待结构化 chunk 稳定后再做。

## 6. Chunk 策略

当前主链路已使用结构化 chunk。`StructuredChunker` 会按 Markdown 标题、段落和 HTML table 切块，表格独立成 `block_type=table`，过长段落才按句子与长度做二级拆分；只有结构化切分无结果时才回退旧 `_chunk_text(max_chars=800, overlap=120)` 固定窗口。更完整的知识发现管线设计已经拆到 `docs/KNOWLEDGE_DISCOVERY_PIPELINE_DESIGN.md`，该文档负责定义通用结构化 chunker、文档画像、按类型 prompt、schema-aware 抽取、归一化和 evidence 校验。

### 第一阶段：兼容模式

1. MinerU 输出 Markdown。
2. 去掉明显空白。
3. 仅在结构化 chunk 为空时回退 `_chunk_text`。
4. 记录 `parser_provider=mineru`。

优点：接入快，风险低。
缺点：表格、标题层级、页码等结构价值没有完全释放。

### 第二阶段：结构化 chunk

按以下优先级切块：

1. 标题层级。
2. 段落。
3. 表格整体或表格分段。
4. 公式与相邻解释文本绑定。
5. 图片描述与标题/上下文绑定。

chunk 元数据建议：

```text
chunk_id
doc_id
text
markdown
block_type
heading_path
page_start
page_end
source_parser
source_bbox
```

这样可以改进：

1. QA 引用定位。
2. 图谱节点来源追踪。
3. Milvus 召回解释。
4. 后台解析质量诊断。

## 7. 对 Neo4j 的影响

当前 Neo4j 写入：

1. `Document`
2. `Chunk`
3. `Entity`
4. `Document -[:HAS_CHUNK]-> Chunk`
5. `Chunk -[:MENTIONS]-> Entity`
6. `Entity -[:RELATION]-> Entity`

建议新增或预留 Chunk 属性：

```text
parser_provider
parser_version
parse_mode
block_type
heading_path
page_start
page_end
source_location
```

不建议第一阶段新增复杂节点类型。
表格、图片、公式是否成为独立节点，等结构化 chunk 稳定后再决定。

当前实现已把以上属性写入 `Chunk`，同时把 `parser_provider`、`parser_version`、`parse_mode`、`parsed_artifact_path` 写入 `Document`。

## 8. 对 Milvus 的影响

Milvus 当前索引字段包括：

1. `chunk_id`
2. `doc_id`
3. `text`
4. `title`
5. `location`
6. `content_hash`
7. `embedding_model`
8. `entities_json`
9. `vector`

接入 MinerU 后建议写入额外 dynamic metadata：

```text
parser_provider
parser_version
parse_mode
block_type
heading_path
page_start
page_end
source_location
```

这样检索诊断时可以回答：

1. 命中的 chunk 来自 native 还是 MinerU。
2. 命中的是段落、表格还是图片说明。
3. 引用可以定位到页码和标题路径。

## 9. 对任务中心的影响

文档解析应该作为建图任务内的可观测阶段出现。

建议任务阶段：

```text
pending
parsing
chunking
extracting_entities
extracting_relations
writing_graph
indexing_vectors
succeeded / failed / cancelled
```

第一阶段不一定要完整拆状态机，但至少在 job result 中返回：

```text
parser_provider
parsed_documents
parse_failures
parse_warnings
vector_indexed
vector_failures
```

当前实现已在 `build_graph` 任务 payload 中支持 `parser_provider`，Python worker 会传递到建图执行层；建图时会落盘标准化解析产物并在 `Document.parsed_artifact_path` 中记录目录；建图结果中已返回 `parser_provider`、`parse_warnings`、`vector_indexed`、`vector_failures`。任务阶段拆分仍未做，后续应在任务中心状态机层推进。

## 10. 对后台 UI 的影响

知识库治理页后续建议展示：

1. 解析器：native / mineru。
2. 解析状态：未解析 / 解析中 / 成功 / 失败 / 回退。
3. 页数。
4. chunk 数。
5. 表格数、图片数、公式数。
6. OCR 是否触发。
7. 最近解析耗时。
8. 重新解析按钮。

配置中心已在 `AI / 模型 / 检索` 页新增 `文档解析 / MinerU` 分区：

1. provider：native / mineru。
2. MinerU API 地址。
3. endpoint path：默认 `/file_parse`。
4. file field：默认 `files`。
5. parse mode：auto / ocr / txt。
6. output format：默认 `markdown,json`。
7. timeout。
8. fallback：native / none。
9. 连通性测试：`POST /api/v1/admin/config/test/document_parser`。

## 11. Docker 部署建议

### 11.1 开发环境

建议在 `docker-compose.dev.yml` 中增加可选 profile：

```text
profile: document-parser
service: mineru-api
```

默认不启动，避免拖慢普通开发环境。

启动方式示例：

```bash
docker compose -f docker-compose.dev.yml --profile document-parser up -d mineru-api
```

### 11.2 生产环境

建议独立部署 MinerU：

1. 独立容器或独立机器。
2. 单独资源限制。
3. 单独模型缓存卷。
4. 单独日志与健康检查。
5. GPU 环境单独调度。

GraphInsight 只依赖 `MINERU_BASE_URL`，不绑定 MinerU 进程生命周期。

## 12. 回退策略

必须支持回退，避免 MinerU 不可用导致建图完全失败。

建议规则：

1. `provider=native`：只用当前解析。
2. `provider=mineru` + `fallback=native`：MinerU 成功用 MinerU，失败回退 native。
3. `provider=mineru` + `fallback=none`：MinerU 失败则文档解析失败。

默认建议：

```text
provider=native
fallback=native
```

正式切换前，先允许单任务指定 `parser_provider=mineru` 做灰度。

当前已支持灰度方式：

```json
{
  "parser_provider": "mineru"
}
```

该字段可放入 `POST /api/v1/admin/jobs/build-graph` 的 `payload`，也可在公开 `POST /api/graph/build` 请求体中直接传入。

## 13. 最小验收样例

至少准备四类文件：

1. 普通文本 PDF：验证不回退，chunk 与问答可用。
2. 扫描 PDF：验证 OCR 生效，native 为空时 MinerU 有文本。
3. 表格 PDF：验证表格以 Markdown/HTML 进入 chunk。
4. DOCX：验证 native 与 MinerU 结果差异，确认不因接入 MinerU 破坏 DOCX。

验收指标：

1. 解析任务可完成。
2. 解析失败有明确原因。
3. fallback 有日志和 result 记录。
4. Neo4j chunk 数合理。
5. Milvus 索引数与 chunk 数接近。
6. DocQA 引用能定位到文档、标题或页码。
7. 检索诊断能显示命中的 parser provider 和 block type。

## 14. 分阶段实施建议

### 阶段 A：设计与接口抽象

1. 新增 `DocumentParser` 抽象。
2. 把当前 `_read_text` 移到 `NativeDocumentParser`。
3. 定义 `ParsedDocument` 与 `ParsedBlock`。
4. 不改变现有行为。

状态：已完成基础实现。

验收：原生解析行为保持兼容；新增 `backend/tests/check_document_parser_unit.py` 和 runtime config boundary guard。

### 阶段 B：MinerU sidecar 调用

1. 增加 `MinerUDocumentParser`。
2. 支持 HTTP 调用 MinerU API。
3. 支持超时、失败、fallback。
4. 只消费 Markdown/text。

状态：已完成基础实现。

验收：指定 `parser_provider=mineru` 的 PDF 会调用 sidecar；MinerU 地址缺失或调用失败时可回退 native；已用真实 MinerU API 验证 `files + parse_method=auto` 合约可返回 `results.*.md_content`；建图后会在 `parsed_documents/{doc_id}` 写入 Markdown、blocks、chunks、structured chunks、document profile、extraction schema 与 raw 响应，便于排障和验收。

### 阶段 C：结构化 chunk

1. 从 MinerU JSON 提取 block。
2. 按标题、段落、表格切 chunk。
3. 写入 chunk metadata。
4. Milvus 写入 parser/block/page metadata。

验收：表格 PDF 的问答引用明显优于 native。

状态：基础完成。建图阶段已接入 `StructuredChunker`，可从 MinerU Markdown 识别标题层级、段落和 HTML table；当前 PDF 重建后生成 14 个 chunk，其中 3 个表格独立为 `block_type=table`，并写入 `caption/neighbor_before/neighbor_after/table_columns/table_rows_json` 和 `structured_chunks.jsonl`。列表、条款、图片说明、公式、跨页表格和更细 page/bbox 定位仍待增强。

### 阶段 D：后台治理

1. 配置中心新增文档解析分区。
2. 知识库治理页展示解析状态与解析器。
3. 任务中心展示解析阶段和 parser result。
4. QA trace 展示 parser metadata。

验收：管理员可以判断“问答差是解析差、索引差、检索差还是模型差”。

状态：部分完成。配置中心文档解析分区和 MinerU 健康检查已完成；知识库治理解析状态、任务解析阶段和 QA trace parser metadata 展示仍待做。

## 15. 当前建议

下一步建议继续补知识发现评测集，并用四类验收样例做端到端验证。
当前已完成 MinerU sidecar、结构化 chunk、DocumentProfiler、动态 schema 和类型 prompt 的基础工程边界，保留现有 native 行为不变。

原因：

1. 解析器边界已经抽出，后续 MinerU、其他 OCR 服务、商业解析 API 都可以复用同一接口。
2. 当前结构化 chunk 仍需增强列表、条款、图片说明、公式、跨页表格和精确 page/bbox 定位。
3. 后台配置和知识库治理还需要补 UI，但后端已经具备任务级灰度参数和解析/抽取产物落盘。
