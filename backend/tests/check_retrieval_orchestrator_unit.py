#!/usr/bin/env python3
"""Unit-style checks for DocQA retrieval orchestration."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch


BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _fake_item(chunk_id: str, score: float, text: str | None = None) -> dict:
    return {
        "id": chunk_id,
        "title": "Doc",
        "location": "Chunk 0",
        "text": text or f"text {chunk_id}",
        "snippet": (text or f"text {chunk_id}")[:160],
        "doc_id": "doc-1",
        "entity_names": [],
        "retrieval_score": score,
    }


def _check_keyword_mode() -> None:
    from services.retrieval_orchestrator import RetrievalOrchestrator

    service = RetrievalOrchestrator()
    with patch(
        "services.retrieval_orchestrator.get_retrieval_runtime_config",
        return_value={
            "mode": "keyword",
            "rrf_k": 60,
            "candidate_multiplier": 4,
            "graph_enabled": True,
            "rerank_enabled": False,
        },
    ), patch.object(service, "_keyword_search", return_value=[_fake_item("c1", 0.8)]) as keyword_search:
        result = service.retrieve("hello", 2)

    _assert(keyword_search.called, "keyword search should be called")
    _assert(result["items"][0]["id"] == "c1", f"unexpected retrieval result: {result}")
    _assert(result["trace"]["mode"] == "keyword", f"unexpected mode trace: {result['trace']}")


def _check_hybrid_fusion_prefers_multi_source_hit() -> None:
    from services.retrieval_orchestrator import RetrievalOrchestrator

    service = RetrievalOrchestrator()
    with patch(
        "services.retrieval_orchestrator.get_retrieval_runtime_config",
        return_value={
            "mode": "hybrid",
            "rrf_k": 60,
            "candidate_multiplier": 4,
            "graph_enabled": True,
            "rerank_enabled": False,
        },
    ), patch.object(
        service,
        "_keyword_search",
        return_value=[_fake_item("shared", 0.8), _fake_item("keyword-only", 0.7)],
    ), patch.object(
        service,
        "_vector_search",
        return_value={"items": [_fake_item("vector-only", 0.9), _fake_item("shared", 0.6)], "trace": {"raw_count": 2}},
    ):
        result = service.retrieve("hello", 3)

    ids = [item["id"] for item in result["items"]]
    _assert(ids[0] == "shared", f"shared hit should win fusion, got {ids}")
    _assert(result["items"][0]["retrieval_sources"] == ["keyword", "vector"], result["items"][0])
    _assert(result["trace"]["sources"]["vector"]["raw_count"] == 2, result["trace"])


def _check_vector_disabled_fallback() -> None:
    from services.retrieval_orchestrator import RetrievalOrchestrator

    service = RetrievalOrchestrator()
    with patch(
        "services.retrieval_orchestrator.get_retrieval_runtime_config",
        return_value={
            "mode": "vector",
            "rrf_k": 60,
            "candidate_multiplier": 4,
            "graph_enabled": True,
            "rerank_enabled": False,
        },
    ), patch.object(
        service,
        "_vector_search",
        return_value={"items": [], "trace": {"skip_reason": "vector_store_disabled"}},
    ), patch.object(
        service,
        "_keyword_search",
        return_value=[_fake_item("fallback", 0.5)],
    ) as keyword_search:
        result = service.retrieve("hello", 2)

    _assert(keyword_search.called, "keyword fallback should run when vector has no hits")
    _assert(result["items"][0]["id"] == "fallback", result)
    _assert("keyword_fallback" in result["items"][0]["retrieval_sources"], result["items"][0])


def _check_hybrid_skips_duplicate_keyword_fallback() -> None:
    from services.retrieval_orchestrator import RetrievalOrchestrator

    service = RetrievalOrchestrator()
    with patch(
        "services.retrieval_orchestrator.get_retrieval_runtime_config",
        return_value={
            "mode": "hybrid",
            "rrf_k": 60,
            "candidate_multiplier": 4,
            "graph_enabled": True,
            "rerank_enabled": False,
        },
    ), patch.object(
        service,
        "_keyword_search",
        return_value=[_fake_item("keyword-hit", 0.7)],
    ) as keyword_search, patch.object(
        service,
        "_vector_search",
        return_value={"items": [], "trace": {"skip_reason": "vector_store_disabled"}},
    ):
        result = service.retrieve("hello", 2)

    _assert(keyword_search.call_count == 1, f"hybrid should not repeat keyword fallback, got {keyword_search.call_count}")
    fallback_trace = result["trace"]["sources"]["keyword_fallback"]
    _assert(fallback_trace["skip_reason"] == "keyword_already_queried", fallback_trace)


def _check_index_chunks_skips_when_disabled() -> None:
    from services.retrieval_orchestrator import RetrievalOrchestrator

    service = RetrievalOrchestrator()
    with patch("services.retrieval_orchestrator.vector_store.is_enabled", return_value=False):
        result = service.index_chunks([{"chunk_id": "c1", "text": "hello"}])

    _assert(result["indexed"] == 0, result)
    _assert(result["reason"] == "vector_store_disabled", result)


def _check_index_chunks_carries_parser_metadata() -> None:
    from services.retrieval_orchestrator import RetrievalOrchestrator

    service = RetrievalOrchestrator()
    captured = []

    def _fake_upsert(chunks, vectors):
        captured.extend(chunks)
        return len(chunks)

    with patch("services.retrieval_orchestrator.vector_store.is_enabled", return_value=True), patch(
        "services.retrieval_orchestrator.embedding_service.is_enabled",
        return_value=True,
    ), patch(
        "services.retrieval_orchestrator.embedding_service.config",
        return_value={"batch_size": 8, "model": "embed-test"},
    ), patch(
        "services.retrieval_orchestrator.embedding_service.embed_texts",
        return_value=[[0.1, 0.2]],
    ), patch(
        "services.retrieval_orchestrator.embedding_service.content_hash",
        return_value="hash",
    ), patch(
        "services.retrieval_orchestrator.vector_store.upsert_chunks",
        side_effect=_fake_upsert,
    ):
        result = service.index_chunks(
            [
                {
                    "chunk_id": "c1",
                    "doc_id": "d1",
                    "text": "hello",
                    "parser_provider": "mineru",
                    "parse_mode": "pipeline",
                    "block_type": "text",
                    "page_start": 2,
                    "page_end": 3,
                    "source_location": "page=2",
                    "document_type": "academic_paper",
                    "domain": "agricultural_plant_protection",
                }
            ]
        )

    _assert(result["indexed"] == 1, result)
    _assert(captured[0].metadata["parser_provider"] == "mineru", captured[0].metadata)
    _assert(captured[0].metadata["page_start"] == 2, captured[0].metadata)
    _assert(captured[0].metadata["document_type"] == "academic_paper", captured[0].metadata)


def _check_diagnostics_runs_requested_modes() -> None:
    from services.retrieval_orchestrator import RetrievalOrchestrator

    service = RetrievalOrchestrator()
    with patch(
        "services.retrieval_orchestrator.get_retrieval_runtime_config",
        return_value={
            "mode": "keyword",
            "rrf_k": 60,
            "candidate_multiplier": 4,
            "graph_enabled": True,
            "rerank_enabled": False,
        },
    ), patch.object(
        service,
        "_keyword_search",
        return_value=[_fake_item("keyword-hit", 0.8)],
    ), patch.object(
        service,
        "_vector_search",
        return_value={"items": [_fake_item("vector-hit", 0.9)], "trace": {"raw_count": 1}},
    ), patch.object(
        service,
        "health",
        return_value={"retrieval": {"mode": "keyword"}},
    ):
        result = service.diagnose("hello", 2, modes=["keyword", "vector", "bad", "vector"])

    _assert(result["modes"] == ["keyword", "vector"], result)
    _assert(set(result["runs"].keys()) == {"keyword", "vector"}, result)
    _assert(result["runs"]["keyword"]["items"][0]["id"] == "keyword-hit", result)
    _assert(result["runs"]["vector"]["trace"]["sources"]["vector"]["raw_count"] == 1, result)
    _assert(result["summary"]["best_mode"] == "keyword", result)
    _assert(result["summary"]["modes"]["vector"]["hit_count"] == 1, result)


def _check_diagnostics_summary_recommends_vector_setup() -> None:
    from services.retrieval_orchestrator import RetrievalOrchestrator

    service = RetrievalOrchestrator()
    with patch(
        "services.retrieval_orchestrator.get_retrieval_runtime_config",
        return_value={
            "mode": "keyword",
            "rrf_k": 60,
            "candidate_multiplier": 4,
            "graph_enabled": True,
            "rerank_enabled": False,
        },
    ), patch.object(
        service,
        "_keyword_search",
        return_value=[],
    ), patch.object(
        service,
        "_vector_search",
        return_value={"items": [], "trace": {"skip_reason": "vector_store_disabled"}},
    ), patch.object(
        service,
        "_graph_expand_search",
        return_value=[],
    ), patch.object(
        service,
        "health",
        return_value={"retrieval": {"mode": "keyword"}},
    ):
        result = service.diagnose("hello", 2, modes=["vector", "hybrid", "graph_hybrid"])

    recommendations = result["summary"]["recommendations"]
    _assert("enable_vector_store" in recommendations, result)
    _assert("reindex_or_import_documents" in recommendations, result)
    _assert(result["summary"]["modes"]["hybrid"]["skipped_sources"] == ["vector:vector_store_disabled", "keyword_fallback:keyword_already_queried"], result)


def main() -> int:
    _check_keyword_mode()
    _check_hybrid_fusion_prefers_multi_source_hit()
    _check_vector_disabled_fallback()
    _check_hybrid_skips_duplicate_keyword_fallback()
    _check_index_chunks_skips_when_disabled()
    _check_index_chunks_carries_parser_metadata()
    _check_diagnostics_runs_requested_modes()
    _check_diagnostics_summary_recommends_vector_setup()
    print("RETRIEVAL_ORCHESTRATOR_UNIT_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
