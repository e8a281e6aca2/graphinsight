"""Runtime QA trace recording for Python capability routes."""
from __future__ import annotations

import time
from typing import Any, Dict, Optional

from fastapi import Request
from sqlalchemy.orm import Session

from admin.schemas.qa_traces import QATraceCreate
from admin.services.qa_trace_service import qa_trace_service


def record_qa_trace(
    db: Session,
    *,
    request: Request,
    operator_id: Optional[int],
    qa_type: str,
    question: str,
    top_k: int,
    started_at: float,
    result: Optional[Dict[str, Any]] = None,
    status: str = "success",
    error: Optional[str] = None,
) -> None:
    trace_payload = (result or {}).get("trace") if isinstance(result, dict) else None
    citations = (result or {}).get("citations") if isinstance(result, dict) else []
    answer_preview = (
        (result or {}).get("answer")
        or (result or {}).get("final_conclusion")
        or (result or {}).get("summary")
        or ""
    )
    retrieval = trace_payload.get("retrieval") if isinstance(trace_payload, dict) else None
    generation = trace_payload.get("generation") if isinstance(trace_payload, dict) else None
    response = trace_payload.get("response") if isinstance(trace_payload, dict) else None
    model = generation.get("model") if isinstance(generation, dict) else None
    retrieval_count = int((retrieval or {}).get("count") or len(citations or [])) if isinstance(retrieval, dict) else len(citations or [])

    qa_trace_service.create_trace(
        db,
        QATraceCreate(
            trace_id=getattr(request.state, "trace_id", None),
            qa_type=qa_type,
            status=status,
            question=question,
            operator_id=operator_id,
            model=model,
            top_k=top_k,
            latency_ms=int(round((time.perf_counter() - started_at) * 1000)),
            retrieval_count=retrieval_count,
            citation_count=len(citations or []),
            answer_preview=str(answer_preview or "")[:1200],
            retrieval_snapshot=retrieval,
            generation_snapshot=generation,
            response_snapshot=response,
            error_message=error,
        ),
    )
