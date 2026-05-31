"""
文档问答 API
返回带引用摘要的回答
"""
import time
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core import success_response, error_response, get_logger
from core.observability import get_qa_observability
from services.doc_qa_service import doc_qa_service
from admin.api.deps import require_permission
from admin.database import get_db
from admin.models import AdminUser
from admin.schemas.qa_traces import QATraceCreate
from admin.services import qa_trace_service

router = APIRouter()
logger = get_logger()
qa_metrics = get_qa_observability()


class CitationItem(BaseModel):
    id: str
    title: str
    snippet: str
    location: Optional[str] = None
    entity_names: List[str] = Field(default_factory=list)
    retrieval_score: Optional[float] = None
    confidence: Optional[float] = None
    confidence_level: Optional[str] = None


class DocQARequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    top_k: int = Field(2, ge=1, le=5)
    require_citation: bool = Field(True)


class DocQAResponse(BaseModel):
    answer: str
    citations: List[CitationItem]


class DeepResearchRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    top_k: int = Field(8, ge=3, le=20, description="每个子问题的检索片段上限")
    max_sub_questions: int = Field(4, ge=2, le=8, description="子问题拆解上限")


class DeepResearchResponse(BaseModel):
    question: str
    summary: str
    final_conclusion: str
    report: str
    sub_questions: List[str]
    citations: List[CitationItem]
    confidence: Dict[str, Any]
    evidence_stats: Dict[str, Any]


def _docqa_health_status(result: Dict[str, Any]) -> str:
    neo4j_ok = bool((result.get("neo4j") or {}).get("ok"))
    if not neo4j_ok:
        return "unhealthy"

    retrieval = result.get("retrieval") or {}
    llm = result.get("llm") or {}
    if not bool(retrieval.get("ok")) or not bool(llm.get("ok")):
        return "degraded"

    return "healthy"


def _record_qa_trace(
    db: Session,
    *,
    request: Request,
    current_user: Optional[AdminUser],
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
            operator_id=current_user.id if current_user else None,
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


@router.post(
    "/docqa",
    summary="文档问答",
    description="基于文档库进行问答并返回引用摘要",
)
async def doc_qa(
    payload: DocQARequest,
    request: Request,
    current_user: Optional[AdminUser] = Depends(require_permission("qa:ask", resource="qa")),
    db: Session = Depends(get_db),
):
    started_at = time.perf_counter()
    try:
        result = doc_qa_service.answer(payload.question, payload.top_k)
        citations = []
        for item in result.get("citations", []):
            try:
                citations.append(
                    CitationItem(
                        id=str(item.get("id") or ""),
                        title=str(item.get("title") or "文档片段"),
                        snippet=item.get("snippet") or item.get("text", "")[:140],
                        location=item.get("location"),
                        entity_names=item.get("entity_names") or [],
                        retrieval_score=item.get("retrieval_score"),
                        confidence=item.get("confidence"),
                        confidence_level=item.get("confidence_level"),
                    )
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("构造引用摘要失败", context={"error": str(exc), "item": item})
        response = DocQAResponse(answer=result.get("answer", ""), citations=citations)
        logger.info(
            "文档问答请求",
            context={"question": payload.question, "citations": len(citations)},
        )
        qa_metrics.record_qa(
            qa_type="docqa",
            success=True,
            citation_count=len(citations),
            duration_ms=round((time.perf_counter() - started_at) * 1000, 3),
        )
        _record_qa_trace(
            db,
            request=request,
            current_user=current_user,
            qa_type="docqa",
            question=payload.question,
            top_k=payload.top_k,
            started_at=started_at,
            result=result,
        )
        return success_response(data=response.model_dump(), message="ok")
    except Exception as exc:  # noqa: BLE001
        logger.error("文档问答失败", context={"error": str(exc)})
        qa_metrics.record_qa(
            qa_type="docqa",
            success=False,
            citation_count=0,
            duration_ms=round((time.perf_counter() - started_at) * 1000, 3),
            error=str(exc),
        )
        _record_qa_trace(
            db,
            request=request,
            current_user=current_user,
            qa_type="docqa",
            question=payload.question,
            top_k=payload.top_k,
            started_at=started_at,
            status="failed",
            error=str(exc),
        )
        return error_response(message="问答失败", code=500)


@router.post(
    "/docqa/deep-research",
    summary="文档深度调研",
    description="多子问题检索与结构化调研报告（含引用证据）",
)
async def doc_qa_deep_research(
    payload: DeepResearchRequest,
    request: Request,
    current_user: Optional[AdminUser] = Depends(require_permission("qa:ask", resource="qa")),
    db: Session = Depends(get_db),
):
    started_at = time.perf_counter()
    try:
        result = doc_qa_service.deep_research(
            payload.question,
            top_k=payload.top_k,
            max_sub_questions=payload.max_sub_questions,
        )
        citations = []
        for item in result.get("citations", []):
            try:
                citations.append(
                    CitationItem(
                        id=str(item.get("id") or ""),
                        title=str(item.get("title") or "文档片段"),
                        snippet=item.get("snippet") or item.get("text", "")[:140],
                        location=item.get("location"),
                        entity_names=item.get("entity_names") or [],
                        retrieval_score=item.get("retrieval_score"),
                        confidence=item.get("confidence"),
                        confidence_level=item.get("confidence_level"),
                    )
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("构造引用摘要失败", context={"error": str(exc), "item": item})
        response = DeepResearchResponse(
            question=result.get("question", payload.question),
            summary=result.get("summary", ""),
            final_conclusion=result.get("final_conclusion", ""),
            report=result.get("report", ""),
            sub_questions=result.get("sub_questions", []),
            citations=citations,
            confidence=result.get("confidence", {}),
            evidence_stats=result.get("evidence_stats", {}),
        )
        logger.info(
            "文档深度调研请求",
            context={
                "question": payload.question,
                "sub_questions": len(response.sub_questions),
                "citations": len(citations),
            },
        )
        qa_metrics.record_qa(
            qa_type="deep_research",
            success=True,
            citation_count=len(citations),
            duration_ms=round((time.perf_counter() - started_at) * 1000, 3),
        )
        _record_qa_trace(
            db,
            request=request,
            current_user=current_user,
            qa_type="deep_research",
            question=payload.question,
            top_k=payload.top_k,
            started_at=started_at,
            result=result,
        )
        return success_response(data=response.model_dump(), message="ok")
    except Exception as exc:  # noqa: BLE001
        logger.error("文档深度调研失败", context={"error": str(exc)})
        qa_metrics.record_qa(
            qa_type="deep_research",
            success=False,
            citation_count=0,
            duration_ms=round((time.perf_counter() - started_at) * 1000, 3),
            error=str(exc),
        )
        _record_qa_trace(
            db,
            request=request,
            current_user=current_user,
            qa_type="deep_research",
            question=payload.question,
            top_k=payload.top_k,
            started_at=started_at,
            status="failed",
            error=str(exc),
        )
        return error_response(message="深度调研失败", code=500)


@router.get(
    "/docqa/health",
    summary="文档问答健康检查",
    description="检查 Neo4j 检索链路与 LLM 可用性（可选探测）",
)
async def doc_qa_health(
    probe_llm: bool = False,
    current_user: Optional[AdminUser] = Depends(require_permission("monitor:read", resource="monitor")),
):
    try:
        result = doc_qa_service.diagnose(probe_llm=probe_llm)
        status = _docqa_health_status(result)
        result["status"] = status
        result["checks"] = {
            "neo4j": bool((result.get("neo4j") or {}).get("ok")),
            "retrieval": bool((result.get("retrieval") or {}).get("ok")),
            "llm": bool((result.get("llm") or {}).get("ok")),
        }
        logger.info(
            "文档问答健康检查",
            context={
                "probe_llm": probe_llm,
                "status": status,
                "neo4j_ok": result.get("neo4j", {}).get("ok"),
                "llm_ok": result.get("llm", {}).get("ok"),
            },
        )
        return success_response(data=result, message=status)
    except Exception as exc:  # noqa: BLE001
        logger.error("文档问答健康检查失败", context={"error": str(exc)})
        return success_response(
            data={
                "status": "unhealthy",
                "probe_llm": probe_llm,
                "checks": {"neo4j": False, "retrieval": False, "llm": False},
                "error": str(exc),
            },
            message="unhealthy",
        )
