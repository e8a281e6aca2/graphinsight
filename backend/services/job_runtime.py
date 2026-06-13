"""Python job execution runtime."""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

from config import get_settings
from core import ValidationException, get_logger
from services.document_graph_service import DocumentGraphService, SUPPORTED_EXTS
from services.neo4j_service import get_neo4j_service
from services.runtime_config import get_graph_build_runtime_defaults


logger = get_logger()
settings = get_settings()


def _normalize_reasoning_profile(value: Any, fallback: str) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"fast", "balanced", "deep"}:
        return normalized
    return fallback


def _resolve_doc_dirs() -> List[Path]:
    primary = Path(settings.document_storage_path).resolve()
    primary.mkdir(parents=True, exist_ok=True)
    fallback = (Path(__file__).resolve().parents[1] / "documents").resolve()
    if fallback != primary and fallback.exists():
        return [primary, fallback]
    return [primary]


def _to_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return default


def _safe_index_name(name: str) -> str:
    normalized = "".join(ch for ch in str(name or "").strip() if ch.isalnum() or ch == "_")
    if not normalized:
        return "chunkText"
    return normalized[:64]


def execute_job(*, job_id: int, job_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if job_type == "build_graph":
        return execute_build_graph(job_id=job_id, payload=payload)
    if job_type == "clear_kb":
        return execute_clear_kb(job_id=job_id, payload=payload)
    if job_type == "reindex":
        return execute_reindex(job_id=job_id, payload=payload)
    raise ValidationException(f"任务类型暂不支持执行: {job_type}")


def execute_build_graph(*, job_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
    force = _to_bool(payload.get("force"), False)
    source = str(payload.get("source") or "documents")
    note = payload.get("note")
    doc_ids = [str(item).strip() for item in (payload.get("doc_ids") or []) if str(item).strip()]
    complex_extraction = _to_bool(payload.get("complex_extraction"), False)
    explicit_profile = str(payload.get("reasoning_profile") or "").strip().lower()
    default_profile = "balanced" if complex_extraction else "fast"
    reasoning_profile = explicit_profile or default_profile
    if explicit_profile not in {"fast", "balanced", "deep"}:
        reasoning_profile = _normalize_reasoning_profile(
            get_graph_build_runtime_defaults(complex_extraction=complex_extraction),
            default_profile,
        )

    try:
        stats = DocumentGraphService().build_graph(
            force=force,
            doc_ids=doc_ids or None,
            reasoning_profile=reasoning_profile,
            complex_extraction=complex_extraction,
        )
    except Exception:
        try:
            get_neo4j_service().ensure_connected(force_reconnect=True)
        except Exception as reconnect_exc:  # noqa: BLE001
            logger.warning(
                "建图失败后刷新 Neo4j 连接失败",
                context={"job_id": job_id, "error": str(reconnect_exc)},
            )
        raise

    failures = stats.get("failures", [])
    processed = stats.get("documents", 0)
    total = stats.get("total_documents", 0)
    skipped = stats.get("skipped_documents", 0)

    execution_status = "completed" if processed > 0 else "empty"
    if processed > 0:
        message = "构建完成"
    elif total > 0 and skipped == total:
        execution_status = "completed"
        message = "文档未变更，已跳过"
    elif failures:
        message = "解析失败，未产出图谱"
    else:
        message = "未发现可解析文档"

    return {
        "job_id": job_id,
        "job_type": "build_graph",
        "execution_status": execution_status,
        "message": message,
        "source": source,
        "force": force,
        "note": note,
        "doc_ids": doc_ids,
        "reasoning_profile": reasoning_profile,
        "complex_extraction": complex_extraction,
        "stats": stats,
        "failures": failures,
    }


def execute_clear_kb(*, job_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
    purge_graph = _to_bool(payload.get("purge_graph"), True)
    removed_files = 0
    removed_errors: List[str] = []
    for doc_dir in _resolve_doc_dirs():
        for file in doc_dir.rglob("*"):
            if not file.is_file():
                continue
            if file.suffix.lower() not in SUPPORTED_EXTS:
                continue
            try:
                file.unlink()
                removed_files += 1
            except Exception as exc:  # noqa: BLE001
                removed_errors.append(f"{file.name}: {exc}")

    graph_stats = None
    if purge_graph:
        graph_stats = DocumentGraphService().clear_document_graph()

    return {
        "job_id": job_id,
        "job_type": "clear_kb",
        "execution_status": "completed",
        "message": "知识库已清空",
        "removed_files": removed_files,
        "removed_errors": removed_errors[:20],
        "purge_graph": purge_graph,
        "graph": graph_stats,
    }


def execute_reindex(*, job_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
    index_name = _safe_index_name(str(payload.get("index_name") or "chunkText"))
    neo4j_service = get_neo4j_service()
    before_state: List[Dict[str, Any]] = []
    after_state: List[Dict[str, Any]] = []

    neo4j_service.ensure_connected()
    with neo4j_service.session() as session:
        try:
            before_state = [
                dict(item)
                for item in session.run(
                    "SHOW INDEXES YIELD name, type, state WHERE name = $name RETURN name, type, state",
                    {"name": index_name},
                )
            ]
        except Exception:  # noqa: BLE001
            before_state = []

        session.run(f"DROP INDEX {index_name} IF EXISTS")
        session.run(f"CREATE FULLTEXT INDEX {index_name} IF NOT EXISTS FOR (c:Chunk) ON EACH [c.text]")

        try:
            after_state = [
                dict(item)
                for item in session.run(
                    "SHOW INDEXES YIELD name, type, state WHERE name = $name RETURN name, type, state",
                    {"name": index_name},
                )
            ]
        except Exception:  # noqa: BLE001
            after_state = []

    return {
        "job_id": job_id,
        "job_type": "reindex",
        "execution_status": "completed",
        "message": "索引重建完成",
        "index_name": index_name,
        "before": before_state,
        "after": after_state,
    }
