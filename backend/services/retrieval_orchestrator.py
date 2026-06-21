"""Lightweight retrieval orchestrator for DocQA.

It keeps the public QA contract stable while allowing keyword, vector, and
graph expansion retrieval to evolve independently.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from neo4j import Query

from core import get_logger
from services.embedding_service import embedding_service
from services.neo4j_service import get_neo4j_service
from services.runtime_config import get_retrieval_runtime_config
from services.vector_store import VectorSearchHit, vector_store


logger = get_logger()

RETRIEVAL_QUERY_TIMEOUT_SECONDS = 4.0


@dataclass
class Candidate:
    chunk_id: str
    item: Dict[str, Any]
    ranks: Dict[str, int] = field(default_factory=dict)
    source_scores: Dict[str, float] = field(default_factory=dict)
    fused_score: float = 0.0


class RetrievalOrchestrator:
    def retrieve(self, question: str, top_k: int) -> Dict[str, Any]:
        return self._retrieve_with_mode(question, top_k, mode_override=None)

    def diagnose(self, question: str, top_k: int, modes: Optional[List[str]] = None) -> Dict[str, Any]:
        normalized_question = (question or "").strip()
        requested_modes = modes or ["keyword", "vector", "hybrid", "graph_hybrid"]
        normalized_modes: List[str] = []
        for mode in requested_modes:
            normalized = str(mode or "").strip().lower()
            if normalized not in {"keyword", "vector", "hybrid", "graph_hybrid"}:
                continue
            if normalized not in normalized_modes:
                normalized_modes.append(normalized)
        if not normalized_modes:
            normalized_modes = ["keyword", "vector", "hybrid", "graph_hybrid"]

        runs: Dict[str, Any] = {}
        for mode in normalized_modes:
            result = self._retrieve_with_mode(normalized_question, top_k, mode_override=mode)
            runs[mode] = {
                "items": [self._diagnostic_item(item) for item in result.get("items", [])],
                "trace": result.get("trace", {}),
            }
        summary = self._diagnostic_summary(runs)

        return {
            "query": normalized_question,
            "top_k": max(1, int(top_k or 1)),
            "modes": normalized_modes,
            "runs": runs,
            "summary": summary,
            "health": self.health(),
        }

    def _retrieve_with_mode(self, question: str, top_k: int, mode_override: Optional[str]) -> Dict[str, Any]:
        started_at = time.perf_counter()
        normalized_question = (question or "").strip()
        top_k = max(1, int(top_k or 1))
        cfg = get_retrieval_runtime_config()
        mode = self._normalize_mode(mode_override or str(cfg.get("mode") or "keyword"))
        candidate_limit = max(top_k, top_k * max(1, int(cfg.get("candidate_multiplier") or 6)))

        trace: Dict[str, Any] = {
            "mode": mode,
            "top_k": top_k,
            "candidate_limit": candidate_limit,
            "sources": {},
            "fusion": {"method": "rrf", "rrf_k": int(cfg.get("rrf_k") or 60)},
            "rerank": {"enabled": bool(cfg.get("rerank_enabled")), "applied": False},
        }

        if not normalized_question:
            trace["duration_ms"] = 0
            return {"items": [], "trace": trace}

        source_hits: Dict[str, List[Dict[str, Any]]] = {}

        if mode in {"keyword", "hybrid", "graph_hybrid"}:
            source_hits["keyword"] = self._keyword_search(normalized_question, candidate_limit)
            trace["sources"]["keyword"] = self._source_trace(source_hits["keyword"])

        if mode in {"vector", "hybrid", "graph_hybrid"}:
            vector_result = self._vector_search(normalized_question, candidate_limit)
            source_hits["vector"] = vector_result["items"]
            trace["sources"]["vector"] = {
                **self._source_trace(source_hits["vector"]),
                **vector_result.get("trace", {}),
            }

        if mode == "vector" and not source_hits.get("vector"):
            source_hits["keyword_fallback"] = self._keyword_search(normalized_question, candidate_limit)
            trace["sources"]["keyword_fallback"] = self._source_trace(source_hits["keyword_fallback"])
        elif mode in {"hybrid", "graph_hybrid"} and not source_hits.get("vector"):
            trace["sources"]["keyword_fallback"] = {
                "count": 0,
                "chunk_ids": [],
                "skip_reason": "keyword_already_queried",
            }

        if mode == "graph_hybrid" and bool(cfg.get("graph_enabled", True)):
            seed_ids = self._seed_ids(source_hits)
            graph_hits = self._graph_expand_search(normalized_question, seed_ids, candidate_limit)
            source_hits["graph"] = graph_hits
            trace["sources"]["graph"] = {
                **self._source_trace(graph_hits),
                "seed_count": len(seed_ids),
            }

        items = self._fuse(source_hits, top_k=top_k, rrf_k=int(cfg.get("rrf_k") or 60))
        trace["fusion"]["result_count"] = len(items)
        trace["duration_ms"] = round((time.perf_counter() - started_at) * 1000, 3)
        return {"items": items, "trace": trace}

    def index_chunks(self, chunks: List[Dict[str, Any]]) -> Dict[str, Any]:
        if not vector_store.is_enabled():
            return {"enabled": False, "indexed": 0, "reason": "vector_store_disabled"}
        if not embedding_service.is_enabled():
            return {"enabled": True, "indexed": 0, "reason": "embedding_disabled_or_missing_key"}
        if not chunks:
            return {"enabled": True, "indexed": 0, "reason": "empty_chunks"}

        from services.vector_store import VectorChunk

        cfg = embedding_service.config()
        batch_size = int(cfg.get("batch_size") or 32)
        indexed = 0
        failures: List[str] = []
        for offset in range(0, len(chunks), batch_size):
            batch = [
                item
                for item in chunks[offset : offset + batch_size]
                if str(item.get("chunk_id") or "").strip() and str(item.get("text") or "").strip()
            ]
            if not batch:
                continue
            try:
                vectors = embedding_service.embed_texts([str(item.get("text") or "") for item in batch])
                vector_chunks = [
                    VectorChunk(
                        chunk_id=str(item.get("chunk_id") or ""),
                        doc_id=str(item.get("doc_id") or ""),
                        text=str(item.get("text") or ""),
                        title=str(item.get("title") or ""),
                        location=str(item.get("location") or ""),
                        entities=[str(e) for e in (item.get("entities") or []) if str(e).strip()],
                        content_hash=embedding_service.content_hash(str(item.get("text") or "")),
                        embedding_model=str(cfg.get("model") or ""),
                        metadata=self._chunk_vector_metadata(item),
                    )
                    for item in batch
                ]
                indexed += vector_store.upsert_chunks(vector_chunks, vectors)
            except Exception as exc:  # noqa: BLE001
                failures.append(str(exc))
                logger.warning("Milvus chunk 索引写入失败", context={"error": str(exc), "offset": offset})
        return {
            "enabled": True,
            "indexed": indexed,
            "failures": failures[:5],
            "embedding_model": str(cfg.get("model") or ""),
        }

    @staticmethod
    def _chunk_vector_metadata(item: Dict[str, Any]) -> Dict[str, Any]:
        metadata: Dict[str, Any] = {}
        for key in (
            "parser_provider",
            "parser_version",
            "parse_mode",
            "block_type",
            "heading_path",
            "page_start",
            "page_end",
            "source_location",
            "document_type",
            "domain",
            "profile_version",
            "caption",
            "neighbor_before",
            "neighbor_after",
            "table_columns",
        ):
            if key in item and item.get(key) is not None:
                metadata[key] = item.get(key)
        return metadata

    def delete_doc(self, doc_id: str) -> None:
        try:
            vector_store.delete_doc(doc_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("删除 Milvus 文档向量失败", context={"doc_id": doc_id, "error": str(exc)})

    def clear(self) -> None:
        try:
            vector_store.clear()
        except Exception as exc:  # noqa: BLE001
            logger.warning("清空 Milvus 向量索引失败", context={"error": str(exc)})

    def health(self) -> Dict[str, Any]:
        return {
            "retrieval": get_retrieval_runtime_config(),
            "embedding": {
                "enabled": embedding_service.is_enabled(),
                "model": embedding_service.config().get("model"),
                "dimension": embedding_service.config().get("dimension"),
            },
            "vector_store": vector_store.health(),
        }

    def _keyword_search(self, question: str, limit: int) -> List[Dict[str, Any]]:
        service = get_neo4j_service()
        items: List[Dict[str, Any]] = []
        with service.driver.session() as session:
            try:
                result = session.run(
                    Query(
                        """
                        CALL db.index.fulltext.queryNodes('chunkText', $q) YIELD node, score
                        OPTIONAL MATCH (d:Document)-[:HAS_CHUNK]->(node)
                        OPTIONAL MATCH (node)-[:MENTIONS]->(e:Entity)
                        WITH node, d, score, collect(DISTINCT e.name) AS entity_names
                        RETURN node AS c, d, score, entity_names
                        ORDER BY score DESC
                        LIMIT $limit
                        """,
                        timeout=RETRIEVAL_QUERY_TIMEOUT_SECONDS,
                    ),
                    {"q": question, "limit": limit},
                )
            except Exception:
                result = session.run(
                    Query(
                        """
                        MATCH (d:Document)-[:HAS_CHUNK]->(c:Chunk)
                        WHERE c.text CONTAINS $q
                        OPTIONAL MATCH (c)-[:MENTIONS]->(e:Entity)
                        WITH c, d, collect(DISTINCT e.name) AS entity_names
                        RETURN c, d, 0.0 AS score, entity_names
                        LIMIT $limit
                        """,
                        timeout=RETRIEVAL_QUERY_TIMEOUT_SECONDS,
                    ),
                    {"q": question, "limit": limit},
                )
            for record in result:
                item = self._record_to_item(record)
                if item:
                    items.append(item)
        return items

    def _vector_search(self, question: str, limit: int) -> Dict[str, Any]:
        trace: Dict[str, Any] = {
            "enabled": vector_store.is_enabled(),
            "embedding_enabled": embedding_service.is_enabled(),
        }
        if not vector_store.is_enabled():
            trace["skip_reason"] = "vector_store_disabled"
            return {"items": [], "trace": trace}
        if not embedding_service.is_enabled():
            trace["skip_reason"] = "embedding_disabled_or_missing_key"
            return {"items": [], "trace": trace}

        try:
            vector = embedding_service.embed_query(question)
            if not vector:
                trace["skip_reason"] = "empty_embedding"
                return {"items": [], "trace": trace}
            hits = vector_store.search(vector, limit=limit)
            trace["raw_count"] = len(hits)
            items = self._items_from_vector_hits(hits)
            return {"items": items, "trace": trace}
        except Exception as exc:  # noqa: BLE001
            logger.warning("Milvus 向量检索失败，已回退其他检索源", context={"error": str(exc)})
            trace["error"] = str(exc)
            return {"items": [], "trace": trace}

    def _items_from_vector_hits(self, hits: List[VectorSearchHit]) -> List[Dict[str, Any]]:
        ids = [hit.chunk_id for hit in hits if hit.chunk_id]
        neo4j_items = self._fetch_chunks_by_ids(ids)
        items: List[Dict[str, Any]] = []
        for hit in hits:
            base = neo4j_items.get(hit.chunk_id) or self._item_from_vector_metadata(hit)
            if not base:
                continue
            base = {**base}
            base["retrieval_score"] = self._safe_score(hit.score)
            items.append(base)
        return items

    def _graph_expand_search(self, question: str, seed_ids: List[str], limit: int) -> List[Dict[str, Any]]:
        service = get_neo4j_service()
        items: List[Dict[str, Any]] = []
        with service.driver.session() as session:
            if seed_ids:
                result = session.run(
                    Query(
                        """
                        MATCH (seed:Chunk)
                        WHERE seed.chunk_id IN $seed_ids
                        MATCH (seed)-[:MENTIONS]->(e:Entity)<-[:MENTIONS]-(related:Chunk)
                        WHERE related.chunk_id IS NOT NULL AND NOT related.chunk_id IN $seed_ids
                        OPTIONAL MATCH (d:Document)-[:HAS_CHUNK]->(related)
                        WITH related, d, count(DISTINCT e) AS score, collect(DISTINCT e.name) AS entity_names
                        RETURN related AS c, d, score, entity_names
                        ORDER BY score DESC
                        LIMIT $limit
                        """,
                        timeout=RETRIEVAL_QUERY_TIMEOUT_SECONDS,
                    ),
                    {"seed_ids": seed_ids, "limit": limit},
                )
                for record in result:
                    item = self._record_to_item(record)
                    if item:
                        items.append(item)

            entity_result = session.run(
                Query(
                    """
                    MATCH (e:Entity)<-[:MENTIONS]-(c:Chunk)
                    WHERE size(e.name) >= 2 AND toLower($q) CONTAINS toLower(e.name)
                    OPTIONAL MATCH (d:Document)-[:HAS_CHUNK]->(c)
                    WITH c, d, count(DISTINCT e) AS score, collect(DISTINCT e.name) AS entity_names
                    RETURN c, d, score, entity_names
                    ORDER BY score DESC
                    LIMIT $limit
                    """,
                    timeout=RETRIEVAL_QUERY_TIMEOUT_SECONDS,
                ),
                {"q": question, "limit": limit},
            )
            seen = {str(item.get("id") or "") for item in items}
            for record in entity_result:
                item = self._record_to_item(record)
                if item and str(item.get("id") or "") not in seen:
                    seen.add(str(item.get("id") or ""))
                    items.append(item)
        return items[:limit]

    def _fetch_chunks_by_ids(self, chunk_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        clean_ids = [str(item) for item in chunk_ids if str(item).strip()]
        if not clean_ids:
            return {}
        service = get_neo4j_service()
        result_map: Dict[str, Dict[str, Any]] = {}
        with service.driver.session() as session:
            result = session.run(
                Query(
                    """
                    MATCH (c:Chunk)
                    WHERE c.chunk_id IN $ids
                    OPTIONAL MATCH (d:Document)-[:HAS_CHUNK]->(c)
                    OPTIONAL MATCH (c)-[:MENTIONS]->(e:Entity)
                    WITH c, d, collect(DISTINCT e.name) AS entity_names
                    RETURN c, d, 0.0 AS score, entity_names
                    """,
                    timeout=RETRIEVAL_QUERY_TIMEOUT_SECONDS,
                ),
                {"ids": clean_ids},
            )
            for record in result:
                item = self._record_to_item(record)
                if item:
                    result_map[str(item["id"])] = item
        return result_map

    def _record_to_item(self, record: Any) -> Optional[Dict[str, Any]]:
        chunk = record.get("c")
        doc = record.get("d")
        if not chunk:
            return None
        chunk_props = dict(chunk)
        doc_props = dict(doc) if doc else {}
        text = chunk_props.get("text", "") or ""
        index = chunk_props.get("index")
        raw_entities = record.get("entity_names") or []
        entity_names = sorted(
            {
                str(name).strip()
                for name in raw_entities
                if isinstance(name, str) and str(name).strip()
            }
        )
        return {
            "id": str(chunk_props.get("chunk_id") or chunk.id),
            "title": doc_props.get("name") or "文档片段",
            "location": f"Chunk {index}" if index is not None else None,
            "text": text,
            "snippet": text[:160].strip() if text else "",
            "doc_id": chunk_props.get("doc_id") or doc_props.get("doc_id"),
            "entity_names": entity_names,
            "retrieval_score": self._safe_score(record.get("score")),
        }

    def _item_from_vector_metadata(self, hit: VectorSearchHit) -> Optional[Dict[str, Any]]:
        metadata = hit.metadata or {}
        text = str(metadata.get("text") or "")
        entities: List[str] = []
        raw_entities = metadata.get("entities_json")
        if isinstance(raw_entities, str) and raw_entities.strip():
            try:
                parsed = json.loads(raw_entities)
                if isinstance(parsed, list):
                    entities = [str(item) for item in parsed if str(item).strip()]
            except Exception:
                entities = []
        return {
            "id": hit.chunk_id,
            "title": str(metadata.get("title") or "文档片段"),
            "location": str(metadata.get("location") or "") or None,
            "text": text,
            "snippet": text[:160].strip() if text else "",
            "doc_id": metadata.get("doc_id"),
            "entity_names": entities,
            "retrieval_score": self._safe_score(hit.score),
        }

    def _fuse(self, source_hits: Dict[str, List[Dict[str, Any]]], *, top_k: int, rrf_k: int) -> List[Dict[str, Any]]:
        weights = {
            "keyword": 1.0,
            "keyword_fallback": 0.8,
            "vector": 1.0,
            "graph": 0.7,
        }
        candidates: Dict[str, Candidate] = {}
        for source, hits in source_hits.items():
            weight = weights.get(source, 1.0)
            seen_in_source = set()
            for rank, item in enumerate(hits, start=1):
                chunk_id = str(item.get("id") or "").strip()
                if not chunk_id or chunk_id in seen_in_source:
                    continue
                seen_in_source.add(chunk_id)
                candidate = candidates.get(chunk_id)
                if not candidate:
                    candidate = Candidate(chunk_id=chunk_id, item={**item})
                    candidates[chunk_id] = candidate
                candidate.ranks[source] = rank
                source_score = item.get("retrieval_score")
                if source_score is not None:
                    candidate.source_scores[source] = float(source_score)
                candidate.fused_score += weight / (rrf_k + rank)

        if not candidates:
            return []

        ranked = sorted(candidates.values(), key=lambda item: item.fused_score, reverse=True)
        max_score = ranked[0].fused_score if ranked else 1.0
        items: List[Dict[str, Any]] = []
        for idx, candidate in enumerate(ranked[:top_k], start=1):
            item = {**candidate.item}
            item["retrieval_score"] = round(candidate.fused_score / max_score, 3) if max_score else 0.0
            item["retrieval_sources"] = sorted(candidate.ranks.keys())
            item["retrieval_ranks"] = candidate.ranks
            item["source_scores"] = candidate.source_scores
            item["retrieval_rank"] = idx
            items.append(item)
        return items

    @staticmethod
    def _source_trace(items: List[Dict[str, Any]], limit: int = 10) -> Dict[str, Any]:
        return {
            "count": len(items),
            "chunk_ids": [str(item.get("id") or "") for item in items[:limit]],
        }

    @staticmethod
    def _diagnostic_item(item: Dict[str, Any]) -> Dict[str, Any]:
        text = str(item.get("text") or item.get("snippet") or "")
        return {
            "id": str(item.get("id") or ""),
            "title": str(item.get("title") or ""),
            "location": item.get("location"),
            "doc_id": item.get("doc_id"),
            "retrieval_score": item.get("retrieval_score"),
            "retrieval_rank": item.get("retrieval_rank"),
            "retrieval_sources": item.get("retrieval_sources") or [],
            "retrieval_ranks": item.get("retrieval_ranks") or {},
            "source_scores": item.get("source_scores") or {},
            "entity_names": item.get("entity_names") or [],
            "snippet": text[:240],
        }

    @staticmethod
    def _diagnostic_summary(runs: Dict[str, Any]) -> Dict[str, Any]:
        modes: Dict[str, Any] = {}
        best_mode: Optional[str] = None
        best_hit_count = -1
        slowest_mode: Optional[str] = None
        slowest_duration = -1.0
        skipped_sources: Dict[str, List[str]] = {}

        for mode, run in runs.items():
            items = run.get("items") or []
            trace = run.get("trace") or {}
            sources = trace.get("sources") or {}
            hit_count = len(items)
            duration_ms = RetrievalOrchestrator._safe_float(trace.get("duration_ms"))
            mode_skips: List[str] = []
            source_counts: Dict[str, int] = {}
            for source, source_trace in sources.items():
                if not isinstance(source_trace, dict):
                    continue
                source_counts[source] = int(source_trace.get("count") or 0)
                skip_reason = str(source_trace.get("skip_reason") or "").strip()
                if skip_reason:
                    mode_skips.append(f"{source}:{skip_reason}")
            if hit_count > best_hit_count:
                best_mode = mode
                best_hit_count = hit_count
            if duration_ms > slowest_duration:
                slowest_mode = mode
                slowest_duration = duration_ms
            if mode_skips:
                skipped_sources[mode] = mode_skips
            modes[mode] = {
                "hit_count": hit_count,
                "duration_ms": duration_ms,
                "source_counts": source_counts,
                "skipped_sources": mode_skips,
            }

        return {
            "modes": modes,
            "best_mode": best_mode,
            "slowest_mode": slowest_mode,
            "skipped_sources": skipped_sources,
            "recommendations": RetrievalOrchestrator._diagnostic_recommendations(modes, skipped_sources),
        }

    @staticmethod
    def _diagnostic_recommendations(modes: Dict[str, Any], skipped_sources: Dict[str, List[str]]) -> List[str]:
        recommendations: List[str] = []
        flattened_skips = {reason for reasons in skipped_sources.values() for reason in reasons}
        if any("vector:vector_store_disabled" in reason for reason in flattened_skips):
            recommendations.append("enable_vector_store")
        if any("vector:embedding_disabled_or_missing_key" in reason for reason in flattened_skips):
            recommendations.append("configure_embedding")
        if modes and all(int(item.get("hit_count") or 0) == 0 for item in modes.values()):
            recommendations.append("reindex_or_import_documents")
        if "graph_hybrid" in modes and int((modes["graph_hybrid"].get("source_counts") or {}).get("graph") or 0) == 0:
            recommendations.append("verify_graph_mentions")
        return recommendations

    @staticmethod
    def _safe_float(value: Any) -> float:
        try:
            return round(float(value), 3)
        except Exception:
            return 0.0

    @staticmethod
    def _seed_ids(source_hits: Dict[str, List[Dict[str, Any]]]) -> List[str]:
        ids: List[str] = []
        seen = set()
        for source in ("keyword", "vector"):
            for item in source_hits.get(source, [])[:10]:
                chunk_id = str(item.get("id") or "").strip()
                if chunk_id and chunk_id not in seen:
                    seen.add(chunk_id)
                    ids.append(chunk_id)
        return ids

    @staticmethod
    def _normalize_mode(mode: str) -> str:
        normalized = (mode or "").strip().lower()
        if normalized in {"keyword", "vector", "hybrid", "graph_hybrid"}:
            return normalized
        return "keyword"

    @staticmethod
    def _safe_score(value: Any) -> Optional[float]:
        try:
            score = float(value)
        except Exception:
            return None
        if score < 0:
            score = 0.0
        if score > 1:
            score = 1.0
        return round(score, 3)


retrieval_orchestrator = RetrievalOrchestrator()


__all__ = ["RetrievalOrchestrator", "retrieval_orchestrator"]
