"""
文档解析并入库 Neo4j 的服务
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Dict, List, Optional

from config import get_settings
from core import get_logger
from services.neo4j_service import get_neo4j_service
from services.llm_entity_extractor import llm_entity_extractor
from services.llm_relation_extractor import llm_relation_extractor

logger = get_logger()
settings = get_settings()

SUPPORTED_EXTS = {
    ".txt",
    ".md",
    ".markdown",
    ".csv",
    ".json",
    ".log",
    ".docx",
    ".pdf",
}

STOPWORDS = {
    "the",
    "and",
    "with",
    "from",
    "that",
    "this",
    "have",
    "for",
    "are",
    "was",
    "were",
    "but",
    "not",
    "you",
    "your",
    "他们",
    "我们",
    "这里",
    "以及",
    "但是",
    "因为",
    "因此",
    "进行",
    "已经",
    "相关",
    "作为",
    "本次",
    "信息",
}

STAGE_KEYWORDS = {
    "抽穗扬花期",
    "扬花期",
    "抽穗期",
    "开花期",
    "孕穗期",
    "拔节期",
    "分蘖期",
    "灌浆期",
    "乳熟期",
    "蜡熟期",
    "成熟期",
}

class DocumentGraphService:
    def __init__(self) -> None:
        self.neo4j = None

    def build_graph(self, force: bool = False, doc_ids: Optional[List[str]] = None) -> Dict[str, object]:
        if self.neo4j is None:
            self.neo4j = get_neo4j_service()
        doc_dir = Path(settings.document_storage_path).resolve()
        if not doc_dir.exists():
            doc_dir.mkdir(parents=True, exist_ok=True)

        documents = self._collect_documents(doc_dir, doc_ids=doc_ids)
        if not documents:
            fallback_dir = (Path(__file__).resolve().parents[1] / "documents").resolve()
            if fallback_dir != doc_dir and fallback_dir.exists():
                fallback_docs = self._collect_documents(fallback_dir, doc_ids=doc_ids)
                if fallback_docs:
                    logger.warning(
                        "文档目录切换为后端目录",
                        context={
                            "from": str(doc_dir),
                            "to": str(fallback_dir),
                            "count": len(fallback_docs),
                        },
                    )
                    doc_dir = fallback_dir
                    documents = fallback_docs

        if not documents:
            logger.warning("未发现可解析文档", context={"dir": str(doc_dir)})
            return {"documents": 0, "chunks": 0, "entities": 0}

        logger.info(
            "开始解析文档",
            context={
                "dir": str(doc_dir),
                "count": len(documents),
                "force": force,
                "doc_ids_count": len(doc_ids or []),
            },
        )

        apoc_available = False
        with self.neo4j.driver.session() as session:
            self._ensure_schema(session)
            if settings.llm_relation_dynamic_type:
                apoc_available = self._check_apoc_available(session)
            if force and not doc_ids:
                cleanup = self._clear_graph_data(session)
                logger.info("强制重建前清理旧文档图谱", context=cleanup)

        total_documents = len(documents)
        doc_count = 0
        chunk_count = 0
        entity_count = 0
        relation_count = 0
        skipped_documents = 0
        entity_names: set[str] = set()
        failures: List[Dict[str, str]] = []
        use_dynamic_relations = settings.llm_relation_dynamic_type and apoc_available
        dynamic_relation_failed_logged = False

        for doc in documents:
            try:
                text, error = self._read_text(doc)
                if error:
                    failures.append({"file": doc.name, "reason": error})
                if not text.strip():
                    if not error:
                        failures.append({"file": doc.name, "reason": "empty_text"})
                    logger.warning("文档解析为空，已跳过", context={"file": str(doc)})
                    continue

                doc_id = self._make_doc_id(doc)
                content_hash = hashlib.sha1(text.encode("utf-8", errors="ignore")).hexdigest()

                chunks = self._chunk_text(text)
                chunk_payload = []
                for idx, chunk in enumerate(chunks):
                    entities = self._extract_entities(chunk)
                    relations = self._extract_relations(chunk, entities)
                    entity_names.update(entities)
                    chunk_payload.append(
                        {
                            "chunk_id": f"{doc_id}-{idx:03d}",
                            "index": idx,
                            "text": chunk,
                            "entities": entities,
                            "relations": relations,
                        }
                    )

                with self.neo4j.driver.session() as session:
                    existing = session.run(
                        "MATCH (d:Document {doc_id: $doc_id}) RETURN d.hash AS hash",
                        {"doc_id": doc_id},
                    ).single()
                    if existing and existing.get("hash") == content_hash and not force:
                        skipped_documents += 1
                        logger.info("文档未变更，跳过", context={"doc": doc.name})
                        continue

                    session.run(
                        """
                        MERGE (d:Document {doc_id: $doc_id})
                        SET d.name = $name,
                            d.path = $path,
                            d.ext = $ext,
                            d.size = $size,
                            d.hash = $hash,
                            d.updated_at = timestamp(),
                            d.source = 'document_ingest'
                        """,
                        {
                            "doc_id": doc_id,
                            "name": doc.name,
                            "path": str(doc),
                            "ext": doc.suffix.lower(),
                            "size": doc.stat().st_size,
                            "hash": content_hash,
                        },
                    )

                    session.run(
                        """
                        MATCH (d:Document {doc_id: $doc_id})-[:HAS_CHUNK]->(c:Chunk)
                        DETACH DELETE c
                        """,
                        {"doc_id": doc_id},
                    )

                    session.run(
                        """
                        MATCH ()-[r {doc_id: $doc_id}]-()
                        DELETE r
                        """,
                        {"doc_id": doc_id},
                    )

                    for batch in self._batch(chunk_payload, 50):
                        session.run(
                            """
                            UNWIND $chunks AS c
                            MERGE (ch:Chunk {chunk_id: c.chunk_id})
                            SET ch.text = c.text,
                                ch.index = c.index,
                                ch.doc_id = $doc_id,
                                ch.source = 'document_ingest'
                            WITH ch, c
                            MATCH (d:Document {doc_id: $doc_id})
                            MERGE (d)-[:HAS_CHUNK]->(ch)
                            WITH ch, c
                            UNWIND c.entities AS entityName
                            MERGE (e:Entity {name: entityName})
                            ON CREATE SET e.source = 'document_ingest'
                            MERGE (ch)-[:MENTIONS]->(e)
                            """,
                            {
                                "doc_id": doc_id,
                                "chunks": batch,
                            },
                        )

                        has_relations = any(item.get("relations") for item in batch)
                        if not has_relations:
                            continue

                        if use_dynamic_relations:
                            try:
                                session.run(
                                    """
                                    UNWIND $chunks AS c
                                    UNWIND c.relations AS rel
                                    WITH c, rel
                                    WHERE rel.source IS NOT NULL
                                      AND rel.target IS NOT NULL
                                      AND rel.label IS NOT NULL
                                      AND rel.rel_type IS NOT NULL
                                    MERGE (s:Entity {name: rel.source})
                                    ON CREATE SET s.source = 'document_ingest'
                                    MERGE (t:Entity {name: rel.target})
                                    ON CREATE SET t.source = 'document_ingest'
                                    CALL apoc.create.relationship(
                                      s,
                                      rel.rel_type,
                                      {
                                        label: rel.label,
                                        doc_id: $doc_id,
                                        chunk_id: c.chunk_id,
                                        source: 'document_ingest',
                                        confidence: rel.confidence
                                      },
                                      t
                                    ) YIELD rel AS r
                                    RETURN count(r) AS created
                                    """,
                                    {
                                        "doc_id": doc_id,
                                        "chunks": batch,
                                    },
                                )
                            except Exception as exc:  # noqa: BLE001
                                if not dynamic_relation_failed_logged:
                                    logger.warning(
                                        "动态关系写入失败，回退固定关系",
                                        context={"doc": doc.name, "error": str(exc)},
                                    )
                                    dynamic_relation_failed_logged = True
                                use_dynamic_relations = False

                        if not use_dynamic_relations:
                            session.run(
                                """
                                UNWIND $chunks AS c
                                UNWIND c.relations AS rel
                                WITH c, rel
                                WHERE rel.source IS NOT NULL
                                  AND rel.target IS NOT NULL
                                  AND rel.label IS NOT NULL
                                MERGE (s:Entity {name: rel.source})
                                ON CREATE SET s.source = 'document_ingest'
                                MERGE (t:Entity {name: rel.target})
                                ON CREATE SET t.source = 'document_ingest'
                                MERGE (s)-[r:RELATION {label: rel.label, doc_id: $doc_id, chunk_id: c.chunk_id}]->(t)
                                SET r.source = 'document_ingest',
                                    r.confidence = coalesce(rel.confidence, r.confidence)
                                """,
                                {
                                    "doc_id": doc_id,
                                    "chunks": batch,
                                },
                            )

                doc_count += 1
                chunk_count += len(chunk_payload)
                relation_count += sum(len(item.get("relations", [])) for item in chunk_payload)
            except Exception as exc:  # noqa: BLE001
                logger.error(
                    "文档建图失败",
                    context={"file": str(doc), "error": str(exc)},
                )
                failures.append({"file": doc.name, "reason": str(exc)})
                continue

        entity_count = len(entity_names)
        return {
            "documents": doc_count,
            "chunks": chunk_count,
            "entities": entity_count,
            "relations": relation_count,
            "total_documents": total_documents,
            "skipped_documents": skipped_documents,
            "failures": failures,
            "scope": "selected_documents" if doc_ids else "all_documents",
            "target_doc_ids": doc_ids or [],
        }

    def delete_document_graph(self, doc_id: str) -> Dict[str, int]:
        if self.neo4j is None:
            self.neo4j = get_neo4j_service()

        with self.neo4j.driver.session() as session:
            relation_count = int(
                (
                    session.run(
                        "MATCH ()-[r {doc_id: $doc_id}]-() RETURN count(r) AS c",
                        {"doc_id": doc_id},
                    ).single()
                    or {}
                ).get("c")
                or 0
            )
            if relation_count:
                session.run(
                    "MATCH ()-[r {doc_id: $doc_id}]-() DELETE r",
                    {"doc_id": doc_id},
                )

            chunk_count = int(
                (
                    session.run(
                        "MATCH (c:Chunk {doc_id: $doc_id}) RETURN count(c) AS c",
                        {"doc_id": doc_id},
                    ).single()
                    or {}
                ).get("c")
                or 0
            )
            if chunk_count:
                session.run(
                    "MATCH (c:Chunk {doc_id: $doc_id}) DETACH DELETE c",
                    {"doc_id": doc_id},
                )

            doc_count = int(
                (
                    session.run(
                        "MATCH (d:Document {doc_id: $doc_id}) RETURN count(d) AS c",
                        {"doc_id": doc_id},
                    ).single()
                    or {}
                ).get("c")
                or 0
            )
            if doc_count:
                session.run(
                    "MATCH (d:Document {doc_id: $doc_id}) DETACH DELETE d",
                    {"doc_id": doc_id},
                )

            orphan_entities = self._cleanup_orphan_entities(session)

        return {
            "documents": doc_count,
            "chunks": chunk_count,
            "relations": relation_count,
            "orphan_entities": orphan_entities,
        }

    def clear_document_graph(self) -> Dict[str, int]:
        if self.neo4j is None:
            self.neo4j = get_neo4j_service()
        with self.neo4j.driver.session() as session:
            return self._clear_graph_data(session)

    def preview_delete_document_graph(self, doc_id: str) -> Dict[str, int]:
        if self.neo4j is None:
            self.neo4j = get_neo4j_service()

        with self.neo4j.driver.session() as session:
            relation_count = int(
                (
                    session.run(
                        "MATCH ()-[r {doc_id: $doc_id}]-() RETURN count(r) AS c",
                        {"doc_id": doc_id},
                    ).single()
                    or {}
                ).get("c")
                or 0
            )
            chunk_count = int(
                (
                    session.run(
                        "MATCH (c:Chunk {doc_id: $doc_id}) RETURN count(c) AS c",
                        {"doc_id": doc_id},
                    ).single()
                    or {}
                ).get("c")
                or 0
            )
            doc_count = int(
                (
                    session.run(
                        "MATCH (d:Document {doc_id: $doc_id}) RETURN count(d) AS c",
                        {"doc_id": doc_id},
                    ).single()
                    or {}
                ).get("c")
                or 0
            )

        return {
            "documents": doc_count,
            "chunks": chunk_count,
            "relations": relation_count,
            "orphan_entities": 0,
        }

    def preview_clear_document_graph(self) -> Dict[str, int]:
        if self.neo4j is None:
            self.neo4j = get_neo4j_service()
        with self.neo4j.driver.session() as session:
            totals = self._get_graph_totals(session)
        return {
            "documents": totals["documents"],
            "chunks": totals["chunks"],
            "relations": totals["relations"],
            "orphan_entities": 0,
        }

    def get_graph_totals(self) -> Dict[str, int]:
        if self.neo4j is None:
            self.neo4j = get_neo4j_service()
        with self.neo4j.driver.session() as session:
            return self._get_graph_totals(session)

    def _clear_graph_data(self, session) -> Dict[str, int]:
        relation_count = int(
            (
                session.run(
                    """
                    MATCH ()-[r]-()
                    WHERE r.source = 'document_ingest' OR r.doc_id IS NOT NULL
                    RETURN count(r) AS c
                    """
                ).single()
                or {}
            ).get("c")
            or 0
        )
        if relation_count:
            session.run(
                """
                MATCH ()-[r]-()
                WHERE r.source = 'document_ingest' OR r.doc_id IS NOT NULL
                DELETE r
                """
            )

        chunk_count = int(
            (
                session.run(
                    """
                    MATCH (c:Chunk)
                    WHERE c.source = 'document_ingest' OR c.doc_id IS NOT NULL
                    RETURN count(c) AS c
                    """
                ).single()
                or {}
            ).get("c")
            or 0
        )
        if chunk_count:
            session.run(
                """
                MATCH (c:Chunk)
                WHERE c.source = 'document_ingest' OR c.doc_id IS NOT NULL
                DETACH DELETE c
                """
            )

        doc_count = int(
            (
                session.run(
                    "MATCH (d:Document {source: 'document_ingest'}) RETURN count(d) AS c"
                ).single()
                or {}
            ).get("c")
            or 0
        )
        if doc_count:
            session.run("MATCH (d:Document {source: 'document_ingest'}) DETACH DELETE d")

        orphan_entities = self._cleanup_orphan_entities(session)
        return {
            "documents": doc_count,
            "chunks": chunk_count,
            "relations": relation_count,
            "orphan_entities": orphan_entities,
        }

    def _get_graph_totals(self, session) -> Dict[str, int]:
        relation_count = int(
            (
                session.run(
                    """
                    MATCH ()-[r]-()
                    WHERE r.source = 'document_ingest' OR r.doc_id IS NOT NULL
                    RETURN count(r) AS c
                    """
                ).single()
                or {}
            ).get("c")
            or 0
        )
        chunk_count = int(
            (
                session.run(
                    """
                    MATCH (c:Chunk)
                    WHERE c.source = 'document_ingest' OR c.doc_id IS NOT NULL
                    RETURN count(c) AS c
                    """
                ).single()
                or {}
            ).get("c")
            or 0
        )
        doc_count = int(
            (
                session.run(
                    "MATCH (d:Document {source: 'document_ingest'}) RETURN count(d) AS c"
                ).single()
                or {}
            ).get("c")
            or 0
        )
        entity_count = int(
            (
                session.run(
                    "MATCH (e:Entity {source: 'document_ingest'}) RETURN count(e) AS c"
                ).single()
                or {}
            ).get("c")
            or 0
        )
        return {
            "documents": doc_count,
            "chunks": chunk_count,
            "relations": relation_count,
            "entities": entity_count,
        }

    @staticmethod
    def _cleanup_orphan_entities(session) -> int:
        count = int(
            (
                session.run(
                    """
                    MATCH (e:Entity {source: 'document_ingest'})
                    WHERE NOT (e)--()
                    RETURN count(e) AS c
                    """
                ).single()
                or {}
            ).get("c")
            or 0
        )
        if count:
            session.run(
                """
                MATCH (e:Entity {source: 'document_ingest'})
                WHERE NOT (e)--()
                DELETE e
                """
            )
        return count

    def _collect_documents(self, doc_dir: Path, doc_ids: Optional[List[str]] = None) -> List[Path]:
        allowed_ids = {str(item).strip() for item in (doc_ids or []) if str(item).strip()}
        files: List[Path] = []
        for path in doc_dir.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix.lower() in SUPPORTED_EXTS:
                if allowed_ids and self._make_doc_id(path) not in allowed_ids:
                    continue
                files.append(path)
        return files

    def _read_text(self, path: Path) -> tuple[str, str | None]:
        ext = path.suffix.lower()
        if ext in {".txt", ".md", ".markdown", ".csv", ".log"}:
            return path.read_text(encoding="utf-8", errors="ignore"), None
        if ext == ".json":
            try:
                content = json.loads(path.read_text(encoding="utf-8", errors="ignore"))
                return json.dumps(content, ensure_ascii=False, indent=2), None
            except Exception:
                return path.read_text(encoding="utf-8", errors="ignore"), None
        if ext == ".docx":
            try:
                import docx  # type: ignore
            except Exception:
                logger.warning("缺少 python-docx，无法解析 docx", context={"file": str(path)})
                return "", "missing_python_docx"
            doc = docx.Document(str(path))
            return "\n".join([p.text for p in doc.paragraphs if p.text]), None
        if ext == ".pdf":
            # 优先使用更稳的解析器，失败再回退 pypdf
            try:
                import pdfplumber  # type: ignore

                with pdfplumber.open(str(path)) as pdf:
                    pages = [(page.extract_text() or "") for page in pdf.pages]
                return "\n".join(pages), None
            except Exception as exc:
                logger.warning(
                    "pdfplumber 解析失败，回退 pypdf",
                    context={"file": str(path), "error": str(exc)},
                )

            try:
                from pypdf import PdfReader  # type: ignore
            except Exception:
                logger.warning("缺少 pypdf，无法解析 pdf", context={"file": str(path)})
                return "", "missing_pypdf"
            try:
                reader = PdfReader(str(path))
                pages = []
                for page in reader.pages:
                    text = page.extract_text() or ""
                    pages.append(text)
                return "\n".join(pages), None
            except Exception as exc:  # noqa: BLE001
                logger.warning("PDF 解析失败，已跳过", context={"file": str(path), "error": str(exc)})
                return "", f"pdf_parse_error: {exc}"
        return "", "unsupported_file"

    def _chunk_text(self, text: str, max_chars: int = 800, overlap: int = 120) -> List[str]:
        cleaned = re.sub(r"\s+", " ", text).strip()
        if not cleaned:
            return []
        chunks = []
        start = 0
        length = len(cleaned)
        while start < length:
            end = min(length, start + max_chars)
            if end < length:
                tail = cleaned[end : min(length, end + 200)]
                match = re.search(r"[。.!?；;]\s", tail)
                if match:
                    end += match.end()
            chunk = cleaned[start:end].strip()
            if len(chunk) >= 30:
                chunks.append(chunk)
            next_start = end - overlap
            if next_start <= start:
                next_start = end
            start = next_start
        return chunks

    def _extract_entities(self, text: str, max_entities: int = 12) -> List[str]:
        llm_entities = llm_entity_extractor.extract(text)
        if llm_entities:
            return llm_entities[:max_entities]

        tokens = re.findall(r"[\u4e00-\u9fff]{2,6}|[A-Za-z][A-Za-z0-9_-]{2,}", text)
        freq: Dict[str, int] = {}
        for token in tokens:
            lower = token.lower()
            if lower in STOPWORDS:
                continue
            freq[lower] = freq.get(lower, 0) + 1
        ranked = sorted(freq.items(), key=lambda item: item[1], reverse=True)
        result = [token for token, _ in ranked[:max_entities]]
        return result

    def _extract_relations(self, text: str, entities: List[str]) -> List[Dict[str, object]]:
        if len(entities) < 2:
            return []
        relations = llm_relation_extractor.extract(text, entities)
        stage_relations = self._extract_stage_relations(text, entities)
        if stage_relations:
            relations = (relations or []) + stage_relations
        if not relations:
            # LLM 失败时回退到规则抽取，避免图谱只剩 Chunk -> Entity 的结构。
            relations = self._extract_relations_by_rules(text, entities)
        return self._normalize_relations(relations)

    def _normalize_relations(self, relations: List[Dict[str, object]]) -> List[Dict[str, object]]:
        normalized: List[Dict[str, object]] = []
        seen = set()
        for rel in relations:
            source = str(rel.get("source") or "").strip()
            target = str(rel.get("target") or "").strip()
            label = str(rel.get("label") or rel.get("relation") or rel.get("type") or "").strip()
            if not source or not target or not label:
                continue
            if source == target:
                continue
            rel_type = self._normalize_relation_type(label)
            key = (source.lower(), target.lower(), rel_type)
            if key in seen:
                continue
            seen.add(key)
            item: Dict[str, object] = {
                "source": source,
                "target": target,
                "label": label,
                "rel_type": rel_type,
            }
            confidence = rel.get("confidence")
            if isinstance(confidence, (int, float)):
                item["confidence"] = float(confidence)
            normalized.append(item)
            if len(normalized) >= settings.llm_max_relations:
                break
        return normalized

    def _extract_relations_by_rules(self, text: str, entities: List[str]) -> List[Dict[str, object]]:
        relations = self._extract_stage_relations(text, entities)
        seen_pairs = {(item.get("source"), item.get("target"), item.get("label")) for item in relations}

        positions: List[tuple[int, int, str]] = []
        for entity in entities:
            if not entity:
                continue
            escaped = re.escape(entity)
            for match in re.finditer(escaped, text):
                positions.append((match.start(), match.end(), entity))
                # 每个实体保留前两个命中即可，避免大文本组合爆炸
                if sum(1 for p in positions if p[2] == entity) >= 2:
                    break
        positions.sort(key=lambda item: item[0])
        if len(positions) < 2:
            return relations

        max_gap = 80

        for idx, (left_start, left_end, left_entity) in enumerate(positions):
            for right_start, right_end, right_entity in positions[idx + 1 :]:
                if right_start <= left_end:
                    continue
                gap = right_start - left_end
                if gap > max_gap:
                    break
                if left_entity == right_entity:
                    continue
                between = text[left_end:right_start]
                label = self._infer_relation_label(between)
                relations.append(
                    {
                        "source": left_entity,
                        "target": right_entity,
                        "label": label,
                        "confidence": 0.45 if label != "同段提及" else 0.25,
                    }
                )

        if relations:
            return relations

        # 兜底：按实体出现顺序构造弱关系，确保实体层至少有可浏览连边。
        ordered_entities = [item[2] for item in positions]
        deduped_entities: List[str] = []
        seen = set()
        for item in ordered_entities:
            key = item.lower()
            if key in seen:
                continue
            seen.add(key)
            deduped_entities.append(item)
        fallback: List[Dict[str, object]] = []
        for i in range(len(deduped_entities) - 1):
            fallback.append(
                {
                    "source": deduped_entities[i],
                    "target": deduped_entities[i + 1],
                    "label": "同段提及",
                    "confidence": 0.2,
                }
            )
            if len(fallback) >= settings.llm_max_relations:
                break
        return fallback

    @staticmethod
    def _infer_relation_label(window: str) -> str:
        compact = re.sub(r"\s+", "", window or "")
        if not compact:
            return "同段提及"

        keywords = [
            "属于",
            "隶属",
            "位于",
            "包括",
            "包含",
            "使用",
            "采用",
            "导致",
            "影响",
            "合作",
            "生产",
            "采购",
            "批准",
            "发布",
            "制定",
            "实施",
            "支持",
            "关联",
            "相关",
        ]
        for keyword in keywords:
            if keyword in compact:
                return keyword

        phrase_match = re.search(r"[A-Za-z\u4e00-\u9fff]{2,8}", compact)
        if phrase_match:
            phrase = phrase_match.group(0)
            if phrase.lower() not in STOPWORDS:
                return phrase
        return "同段提及"

    def _extract_stage_relations(self, text: str, entities: List[str]) -> List[Dict[str, object]]:
        compact = re.sub(r"\s+", "", text or "")
        relations: List[Dict[str, object]] = []
        seen_pairs = set()

        stage_terms = {term for term in STAGE_KEYWORDS if term in compact}
        # 兼容“抽穗-扬花期 / 抽穗至扬花期 / 抽穗/扬花期”等写法
        if re.search(r"抽穗(?:至|—|-|~|–|/)?扬花期", compact):
            stage_terms.add("抽穗扬花期")
        if re.search(r"抽穗(?:至|—|-|~|–|/)?开花期", compact):
            stage_terms.add("抽穗开花期")
        disease_terms: List[str] = []
        for entity in entities:
            entity_clean = str(entity or "").strip()
            if not entity_clean:
                continue
            if entity_clean.endswith("病") and entity_clean.replace(" ", "") in compact:
                disease_terms.append(entity_clean)
        if "赤霉病" in compact and "赤霉病" not in disease_terms:
            disease_terms.append("赤霉病")

        for disease in disease_terms:
            for stage in stage_terms:
                key = (disease, stage, "高发期")
                if key in seen_pairs:
                    continue
                seen_pairs.add(key)
                relations.append(
                    {
                        "source": disease,
                        "target": stage,
                        "label": "高发期",
                        "confidence": 0.75,
                    }
                )

        return relations

    @staticmethod
    def _normalize_relation_type(label: str) -> str:
        text = str(label or "").strip()
        if not text:
            return "RELATION"
        text = re.sub(r"\s+", "_", text)
        text = re.sub(r"[^\w\u4e00-\u9fff]", "_", text)
        text = re.sub(r"_+", "_", text).strip("_")
        if not text:
            suffix = hashlib.sha1(label.encode("utf-8", errors="ignore")).hexdigest()[:8]
            return f"REL_{suffix}"
        if re.match(r"^[\d_]", text):
            text = f"REL_{text}"
        if len(text) > 32:
            suffix = hashlib.sha1(text.encode("utf-8", errors="ignore")).hexdigest()[:6]
            text = f"{text[:24]}_{suffix}"
        if re.match(r"^[A-Za-z0-9_]+$", text):
            return text.upper()
        return text

    def _check_apoc_available(self, session) -> bool:
        try:
            session.run("RETURN apoc.version() AS version").single()
            return True
        except Exception as exc:  # noqa: BLE001
            logger.info(
                "APOC 未启用，动态关系类型已关闭",
                context={"error": str(exc)},
            )
            return False

    def _make_doc_id(self, path: Path) -> str:
        return hashlib.sha1(str(path).encode("utf-8", errors="ignore")).hexdigest()[:12]

    def _ensure_schema(self, session) -> None:
        try:
            session.run(
                "CREATE CONSTRAINT document_id IF NOT EXISTS FOR (d:Document) REQUIRE d.doc_id IS UNIQUE"
            )
            session.run(
                "CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.chunk_id IS UNIQUE"
            )
            session.run(
                "CREATE CONSTRAINT entity_name IF NOT EXISTS FOR (e:Entity) REQUIRE e.name IS UNIQUE"
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("创建约束失败", context={"error": str(exc)})

        try:
            session.run(
                "CREATE FULLTEXT INDEX chunkText IF NOT EXISTS FOR (c:Chunk) ON EACH [c.text]"
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("创建全文索引失败", context={"error": str(exc)})

    @staticmethod
    def _batch(items: List[Dict], size: int) -> List[List[Dict]]:
        return [items[i : i + size] for i in range(0, len(items), size)]


__all__ = ["DocumentGraphService"]
