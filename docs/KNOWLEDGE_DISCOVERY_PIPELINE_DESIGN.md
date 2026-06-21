# GraphInsight 知识发现管线设计

更新时间：2026-06-22
状态：设计中；结构化 chunker、DocumentProfiler、动态 schema、类型化 prompt、实体归一化、表格行级关系抽取、schema-aware LLM 关系抽取、evidence 校验和高价值事实规则抽取基础实现已接入；后台人工覆盖、抽取评测集、跨文档 schema 治理和更细 page/bbox 定位待实施

## 1. 背景

当前 GraphInsight 已完成 MinerU sidecar 接入、解析产物落盘、Neo4j 图谱写入和 Milvus 混合检索底座。
但建图链路仍有两个核心问题需要继续治理：

1. 结构化 chunker 已覆盖标题、段落和 HTML table，但列表、条款、图片说明、公式、跨页表格和精确 page/bbox 定位仍需增强。
2. 实体/关系抽取已接入文档类型识别、动态 schema、类型 prompt 和 evidence 校验，但默认 LLM 抽取预算仍偏保守，跨全文关系发现和评测集仍需继续建设。
3. 2026-06-22 已补充农业试验类高价值事实规则兜底：试验时间、试验地点、海拔、土壤类型、土壤肥力、pH、供试品种、供试药剂提供方、施药器械、作者工作单位。该规则用于避免向量可答但图谱只剩 `Chunk -> Entity` 的弱结构。

结果是：文档能被解析，但图谱容易退化为 `Document -> Chunk -> Entity`，缺少高质量实体间关系。

本设计目标是把建图从“固定 chunk + 直接抽取”升级为“结构化 chunk + 自动知识发现”。

## 2. 核心原则

1. chunker 不写领域知识，只保留通用文档结构。
2. 领域抽取策略放在 prompt 和 document profile 中演进，不硬编码到 chunker。
3. LLM 输出必须经过结构化协议、归一化、证据校验后才能入图。
4. 每个实体、关系和 claim 都应能追溯到原文 evidence、chunk_id、heading_path 和 source_location。
5. 允许自动识别文档类型，也允许后台人工覆盖文档类型。
6. 规则只能做通用兜底和格式稳定，不能替代知识发现模型。

## 3. 推荐目录

```text
backend/services/knowledge_discovery/
  __init__.py

  chunking/
    __init__.py
    structured_chunker.py
    markdown_blocks.py
    table_extractor.py
    neighbors.py

  profiling/
    __init__.py
    document_profiler.py
    document_types.py

  extraction/
    __init__.py
    schema_extractor.py
    entity_relation_extractor.py
    evidence_validator.py

  normalization/
    __init__.py
    entity_normalizer.py
    relation_normalizer.py
    units.py

  prompts/
    base/
      document_profile.zh.md
      entity_relation_extract.zh.md
      evidence_validate.zh.md

    types/
      academic_paper.zh.md
      contract.zh.md
      financial_report.zh.md
      policy.zh.md
      product_manual.zh.md
      meeting_minutes.zh.md
      unknown.zh.md
```

分层职责：

1. `chunking`：通用结构化切分，不理解业务领域。
2. `profiling`：判断文档类型、领域、重点章节和候选 schema。
3. `extraction`：按 schema 抽取实体、关系、claim 和 evidence。
4. `normalization`：实体别名合并、关系归一、单位归一、脏 JSON 清理。
5. `prompts`：提示词资产，按基础协议和文档类型拆分。

## 4. 管线流程

```text
DocumentParser
  -> ParsedDocument / ParsedBlock
  -> StructuredChunker
  -> DocumentProfiler
  -> DynamicExtractionSchema
  -> EntityRelationExtractor
  -> EntityNormalizer
  -> RelationNormalizer
  -> EvidenceValidator
  -> Neo4j / Milvus / QA trace
```

### 4.1 Parser

输入来自现有解析器：

1. `NativeDocumentParser`
2. `MinerUDocumentParser`

输出继续使用：

```text
ParsedDocument
  text
  parser_provider
  parser_version
  parse_mode
  blocks[]
  warnings[]
  raw_payload
  raw_output_path
```

### 4.2 StructuredChunker

目标不是理解领域，而是不破坏语义边界。

通用 chunk 类型：

```text
title
abstract
section
paragraph
table
list
clause
figure_caption
formula
appendix
reference
unknown
```

标准输出：

```json
{
  "chunk_id": "doc-001-c0003",
  "block_type": "table",
  "heading_path": ["2 结果与分析", "2.1 不同药剂处理小麦条锈病的防效"],
  "caption": "表 2 不同药剂处理小麦条锈病的防效",
  "text": "...",
  "table": {
    "columns": ["处理", "末次药后7d平均病情指数", "平均防效"],
    "rows": []
  },
  "neighbors": {
    "before": "从表 2 可知...",
    "after": "注：同列不同小写字母表示处理间差异显著..."
  },
  "page_start": 2,
  "page_end": 2,
  "source_location": "page=2,bbox=..."
}
```

切分规则：

1. 标题层级形成 `heading_path`。
2. 表格独立成 chunk，不与普通段落混在同一个字符窗口。
3. 表格前后说明作为 neighbors 关联，不强行拼接进表格主体。
4. 列表、条款、公式、图片说明保持完整，不按固定长度切断。
5. 过长段落才做二级拆分，拆分时保留同一个 `heading_path`。
6. 每个 chunk 都保留 parser metadata。

### 4.3 DocumentProfiler

Profiler 负责自动判断“这是什么文档、应该抽什么”。

当前实现位置：

```text
backend/services/knowledge_discovery/profiling/document_profiler.py
backend/services/knowledge_discovery/profiling/document_types.py
```

Profiler 采用轻量启发式识别文档类型和领域，不承担实体/关系抽取。它的职责是给抽取器提供 `document_type/domain/main_topics/important_sections/suggested_entity_types/suggested_relation_types`，避免把领域逻辑写死在 chunker 或建图服务里。

输出示例：

```json
{
  "document_type": "academic_paper",
  "domain": "agricultural_plant_protection",
  "language": "zh",
  "main_topics": ["小麦条锈病", "药剂防治", "防效", "产量"],
  "important_sections": ["摘要", "材料与方法", "结果与分析", "小结"],
  "suggested_entity_types": ["作物", "病害", "药剂", "处理", "指标", "地点", "时间", "机构"],
  "suggested_relation_types": ["防治对象", "平均防效", "病情指数", "产量", "增产率", "推荐使用"],
  "confidence": 0.92
}
```

文档类型初始集合：

1. `academic_paper`
2. `contract`
3. `financial_report`
4. `policy`
5. `product_manual`
6. `meeting_minutes`
7. `unknown`

### 4.4 DynamicExtractionSchema

Schema 不固定在代码里，由 base prompt + type prompt + profiler 输出组成。

当前实现位置：

```text
backend/services/knowledge_discovery/extraction/schema_extractor.py
backend/services/knowledge_discovery/prompts/base/entity_relation_extract.zh.md
backend/services/knowledge_discovery/prompts/types/*.zh.md
```

标准结构：

```json
{
  "entity_types": [
    {"name": "药剂", "description": "用于处理或防治对象的药物、制剂或处理方案"}
  ],
  "relation_types": [
    {"name": "平均防效", "source_type": "药剂", "target_type": "病害", "value_type": "percentage"}
  ],
  "attribute_types": [
    {"name": "稀释倍数", "value_type": "string"},
    {"name": "产量", "value_type": "measurement"}
  ]
}
```

### 4.5 EntityRelationExtractor

抽取输出必须结构化，禁止让业务层直接消费任意自然语言。

标准输出：

```json
{
  "entities": [
    {
      "name": "125 g/L 氟环唑 SC",
      "type": "药剂",
      "aliases": ["125 g/L氟环唑SC", "氟环唑 SC"],
      "attributes": {},
      "evidence": "125 g/L 氟环唑 SC（89.93%）",
      "confidence": 0.94
    }
  ],
  "relations": [
    {
      "source": "125 g/L 氟环唑 SC",
      "target": "小麦条锈病",
      "type": "防治对象",
      "attributes": {
        "平均防效": "89.93%",
        "病情指数": "5.70%",
        "产量": "144.25 kg/667m²",
        "增产率": "13.42%",
        "稀释倍数": "750倍"
      },
      "evidence": "平均防效依次为 125 g/L 氟环唑 SC（89.93%）...",
      "confidence": 0.91
    }
  ],
  "claims": [
    {
      "subject": "125 g/L 氟环唑 SC",
      "predicate": "建议优先推广使用",
      "object": "防治小麦条锈病",
      "evidence": "金沙县防治小麦条锈病建议优先推广使用125 g/L氟环唑SC",
      "confidence": 0.9
    }
  ]
}
```

## 5. Prompt 资产设计

### 5.1 Base Prompt

`prompts/base/entity_relation_extract.zh.md` 负责统一协议：

1. 只输出 JSON。
2. 实体必须有 `name/type/evidence/confidence`。
3. 关系必须有 `source/target/type/evidence/confidence`。
4. source/target 必须能在实体表或当前 chunk 中找到依据。
5. 不确定则降低 confidence，不臆造。
6. 表格要优先按行抽取结构化关系。
7. evidence 必须是原文短句或表格行，不允许生成解释性证据。

### 5.2 Type Prompt

类型 prompt 只补充该类文档关注点。

`academic_paper.zh.md`：

```text
重点识别研究对象、方法、实验组、对照组、指标、结果、结论。
表格中的每一行如果是实验处理，应尽量形成处理-指标关系。
```

`contract.zh.md`：

```text
重点识别合同主体、标的、金额、期限、交付义务、付款义务、违约责任、解除条件、管辖条款。
```

`financial_report.zh.md`：

```text
重点识别公司、业务板块、产品、收入、成本、利润、同比、环比、现金流、风险因素。
```

`product_manual.zh.md`：

```text
重点识别产品、部件、参数、操作步骤、故障、告警、解决方案、限制条件。
```

`unknown.zh.md`：

```text
先抽取文档中反复出现的核心对象、指标、动作和约束，关系类型保持通用。
```

当前已落地类型 prompt：

```text
academic_paper.zh.md
contract.zh.md
financial_report.zh.md
policy.zh.md
product_manual.zh.md
meeting_minutes.zh.md
unknown.zh.md
```

## 6. 数据模型扩展

### 6.1 Neo4j

建议保留现有：

```text
Document
Chunk
Entity
RELATION
```

新增或扩展属性：

```text
Document.document_type
Document.domain
Document.profile_confidence
Document.profile_version

Chunk.block_type
Chunk.heading_path
Chunk.caption
Chunk.neighbor_before
Chunk.neighbor_after
Chunk.table_columns
Chunk.document_type
Chunk.domain
Chunk.profile_version

Entity.entity_type
Entity.aliases
Entity.normalized_name
Entity.evidence
Entity.confidence

RELATION.relation_type
RELATION.attributes
RELATION.evidence
RELATION.confidence
RELATION.chunk_id
RELATION.extraction_profile
```

### 6.2 Milvus Metadata

向量 metadata 增加：

```text
document_type
domain
profile_version
block_type
heading_path
caption
entity_types
relation_types
evidence_count
```

### 6.3 解析产物目录

`backend/parsed_documents/{doc_id}/` 后续可增加：

```text
structured_chunks.jsonl
document_profile.json
extraction_schema.json
extraction_results.jsonl
normalization_report.json
```

当前已实际写入：

```text
manifest.json
content.md
blocks.json
chunks.jsonl
structured_chunks.jsonl
document_profile.json
extraction_schema.json
raw.json/raw.txt
```

## 7. 后台配置建议

新增配置分类：

```text
knowledge_discovery.enabled
knowledge_discovery.chunker_mode = structured|legacy
knowledge_discovery.document_type_mode = auto|manual
knowledge_discovery.default_document_type = unknown
knowledge_discovery.profile_model
knowledge_discovery.extract_model
knowledge_discovery.evidence_required = true
knowledge_discovery.max_chunks_per_doc
knowledge_discovery.min_relation_confidence
```

后台页面后续应支持：

1. 查看文档 profile。
2. 人工覆盖 document_type。
3. 查看 structured chunks。
4. 查看每条关系的 evidence。
5. 对单文档重新 profile / 重新抽取 / 重新入图。

## 8. 实施阶段

### 阶段 A：结构化 Chunker

目标：

1. 从 Markdown / ParsedBlock 生成 structured chunks。
2. 表格独立 chunk。
3. 标题路径、caption、neighbors 入 chunk metadata。
4. 解析产物目录写入 `structured_chunks.jsonl`。

验收：

1. 当前 PDF 至少生成摘要、材料方法、表 1、表 2、表 3、小结等语义 chunk。
2. 表格不再被固定字符窗口切断。
3. Neo4j `Chunk.block_type` 能区分 `section/table/paragraph`。

当前状态：基础完成。`StructuredChunker` 已接入建图，当前 PDF 重建后生成 14 个 chunk，其中 `section=11`、`table=3`；表 1、表 2、表 3 均独立成 table chunk，并保留 caption、heading_path、前后说明和 table_columns。后续仍需增强列表、条款、图片说明、公式、跨页表格和更细的 page/bbox 定位。

### 阶段 B：Document Profiler

目标：

1. 自动识别文档类型和领域。
2. 生成候选 entity/relation schema。
3. 写入 `document_profile.json` 和 `Document.document_type/domain`。

验收：

1. 当前 PDF 识别为 `academic_paper` 或近似学术论文类型。
2. 合同、政策、手册样例能识别为不同类型。
3. 低置信度时回退 `unknown`。

当前状态：基础完成。建图阶段已调用 `DocumentProfiler`，初始支持 `academic_paper`、`contract`、`financial_report`、`policy`、`product_manual`、`meeting_minutes`、`unknown`，并把 `document_type/domain/profile_confidence/profile_version` 写入 Neo4j `Document`，同时把 `document_type/domain/profile_version` 写入 `Chunk` 和 Milvus metadata。解析产物目录已写入 `document_profile.json`。当前 profiler 是轻量启发式，后续要补后台人工覆盖、样本评测集和可选 LLM profiler。

### 阶段 C：Schema-aware 抽取

目标：

1. 基于 profile + type prompt 抽取实体、关系、claim。
2. 支持表格按行抽取。
3. 输出 evidence 和 confidence。
4. 修复实体 JSON 污染问题。

验收：

1. 当前 PDF 能抽出药剂、病害、作物、指标、地点、时间等干净实体。
2. 能形成药剂到病害、药剂到防效、药剂到产量/增产率的关系或属性。
3. 脏实体如 `{"entity": ...}` 不再入图。

当前状态：基础完成。实体归一化已清理 LLM 返回的 JSON/dict 污染，并对常见药剂名称空格差异做规范化；表格 chunk 已按“首列主体 -> 其他列指标”生成行级关系，关系写入 `evidence/relation_type/confidence`。LLM 关系抽取已改为 schema-aware 输出，抽取 prompt 会由 `document_profile + DynamicExtractionSchema + base prompt + type prompt + chunk metadata` 组合生成，并要求输出 `source/target/label/evidence/confidence`。旧规则抽取已禁止把任意短语当作关系类型，低置信度“同段提及”不进入默认关系集合；当前 PDF 最近复建结果为 `Chunk=14`、`Entity=113`、`RELATION=85`，无 JSON/dict 脏实体，全部 RELATION 均带 evidence。仍需扩大 LLM 抽取覆盖策略、增加文档类型评测样例，并把 entity_type/attributes/claims 作为后续模型扩展。

运行态约束：图谱抽取器已改为读取配置中心 `ai_service` 的模型、base_url 和 key，不再固定使用启动环境变量中的旧模型。为避免建图被慢模型拖住，默认只有前 2 个非表格 chunk 消耗 LLM 抽取预算，表格 chunk 走结构化规则抽取；`LLM_GRAPH_EXTRACT_MAX_LLM_CHUNKS` 和 `LLM_GRAPH_EXTRACT_TIMEOUT_SECONDS` 可在环境中调整。关系抽取 prompt 默认限制为 `LLM_RELATION_TEXT_BUDGET=1000` 字和 `LLM_RELATION_MAX_PROMPT_ENTITIES=18` 个当前 chunk 中可定位实体，避免把结构化候选实体全部塞给慢模型。图谱实体/关系抽取会使用 bounded reasoning：任务档位 `fast/balanced` 的模型调用都使用 low effort，只有显式 `deep` 才提升到 medium effort。单个 chunk 的 LLM 关系抽取失败不会触发整轮全局熔断；模型不可用、渠道不可用、鉴权失败等 provider 级错误会短暂暂停，累计重复 timeout 也会触发短暂 cooldown，让后续 chunk 交给结构化表格和规则 evidence 抽取兜底。

### 阶段 D：归一化与证据校验

目标：

1. 合并别名。
2. 单位归一。
3. source/target fuzzy match。
4. evidence 必须能在 chunk 中定位。

验收：

1. `125 g/L 氟环唑 SC`、`125 g/L氟环唑SC` 合并为同一实体。
2. 关系均带 evidence。
3. 低置信度或无 evidence 的关系不进入默认图谱。

当前状态：部分完成。药剂名称中 `125 g/L 氟环唑 SC`、`125 g/L氟环唑SC`、`125g/L氟环唑SC` 已规范到 `125g/L氟环唑SC`；表格规则、明确谓词规则关系和阶段关系均尽量写入原文 evidence。LLM 关系已接入 `EvidenceValidator`，只有 evidence 能在 chunk 中定位且同时覆盖 source/target 的关系才进入图谱；无 evidence、证据无法支撑或低置信度的关系会被过滤。跨 chunk 别名合并仍待做。

### 阶段 E：后台治理

目标：

1. 文档详情展示 profile、structured chunks、extraction results。
2. 支持重新 profile、重新抽取、重新入图。
3. QA trace 可回看命中 chunk 的抽取证据。

验收：

1. 后台能解释“为什么图谱节点少 / 为什么关系少”。
2. 能看到每条关系来源于哪个 chunk 和哪段原文。

## 9. 当前 PDF 的目标效果

当前文档：`5种药剂对小麦条锈病的防效.pdf`

期望 profile：

```json
{
  "document_type": "academic_paper",
  "domain": "agricultural_plant_protection",
  "main_topics": ["小麦条锈病", "药剂防治", "田间试验", "防效", "产量"]
}
```

期望核心实体：

```text
小麦
小麦条锈病
25% 三唑酮 WP
12.5% 烯唑醇 WP
430 g/L 戊唑醇 SC
250 g/L 丙环唑 EC
125 g/L 氟环唑 SC
贵州省金沙县茶园镇民乐村
贵州格润惠通农业有限公司
```

期望核心关系：

```text
125 g/L 氟环唑 SC -> 防治对象 -> 小麦条锈病
125 g/L 氟环唑 SC -> 平均防效 -> 89.93%
125 g/L 氟环唑 SC -> 产量 -> 144.25 kg/667m²
125 g/L 氟环唑 SC -> 增产率 -> 13.42%
125 g/L 氟环唑 SC -> 推荐使用 -> 金沙县小麦条锈病防治
```

## 10. 风险与约束

1. 不同模型 JSON 稳定性不同，必须做严格解析和容错。
2. 表格抽取质量依赖 MinerU 输出，必要时要保留 raw table 供二次解析。
3. 自动 profile 可能误判，必须支持人工覆盖。
4. 关系太多会让图谱噪声变大，需要 confidence 阈值和 evidence 过滤。
5. 结构化 chunker 不能过早绑定农业论文，否则会限制合同、财报、手册等文档。

## 11. 近期建议

优先顺序：

1. 补合同、财报、手册、政策、会议纪要的小样例评测集。
2. 增加后台查看和人工覆盖 `document_type/domain` 的入口。
3. 按文档类型和任务档位动态决定 LLM 抽取 chunk 预算，避免默认只抽前 2 个非表格 chunk 导致图谱偏少。
4. 把 entity_type、attributes 和 claims 持久化为后续图谱扩展字段。
5. 增强列表、条款、图片说明、公式、跨页表格和 page/bbox 定位。

不建议下一步直接写农业药效专用规则。可以把当前 PDF 当作验收样例，但底层设计必须保持通用。
