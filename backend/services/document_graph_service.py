"""
文档解析并入库 Neo4j 的服务
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Dict, List

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


class DocumentGraphService:
    def __init__(self) -> None:
        self.neo4j = None

    def build_graph(self, force: bool = False) -> Dict[str, object]:
        if self.neo4j is None:
            self.neo4j = get_neo4j_service()
        doc_dir = Path(settings.document_storage_path).resolve()
        if not doc_dir.exists():
            doc_dir.mkdir(parents=True, exist_ok=True)

        documents = self._collect_documents(doc_dir)
        if not documents:
            fallback_dir = (Path(__file__).resolve().parents[1] / "documents").resolve()
            if fallback_dir != doc_dir and fallback_dir.exists():
                fallback_docs = self._collect_documents(fallback_dir)
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
            context={"dir": str(doc_dir), "count": len(documents), "force": force},
        )

        apoc_available = False
        with self.neo4j.driver.session() as session:
            self._ensure_schema(session)
            if settings.llm_relation_dynamic_type:
                apoc_available = self._check_apoc_available(session)
            if force:
                session.run("MATCH (c:Chunk {source: 'document_ingest'}) DETACH DELETE c")
                session.run("MATCH (d:Document {source: 'document_ingest'}) DETACH DELETE d")

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
        }

    def _collect_documents(self, doc_dir: Path) -> List[Path]:
        files: List[Path] = []
        for path in doc_dir.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix.lower() in SUPPORTED_EXTS:
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
        if relations:
            normalized: List[Dict[str, object]] = []
            for rel in relations:
                source = str(rel.get("source") or "").strip()
                target = str(rel.get("target") or "").strip()
                label = str(rel.get("label") or rel.get("relation") or rel.get("type") or "").strip()
                if not source or not target or not label:
                    continue
                rel_type = self._normalize_relation_type(label)
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
            return normalized[: settings.llm_max_relations]
        return []

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
