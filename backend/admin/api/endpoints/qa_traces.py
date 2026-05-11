"""QA trace admin API."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from ...database import get_db
from ...schemas.qa_traces import QACostSummaryQuery, QATraceQuery
from ...services import qa_trace_service
from ..deps import require_admin_permission
from core import error_response, paginated_response, success_response, get_logger

logger = get_logger()

router = APIRouter(
    prefix="/admin/qa-traces",
    tags=["qa-traces"],
    dependencies=[Depends(require_admin_permission("monitor:read", resource="qa_trace"))],
)


@router.get("", summary="List QA traces")
async def list_qa_traces(
    qa_type: str | None = Query(default=None),
    status_value: str | None = Query(default=None, alias="status"),
    trace_id: str | None = Query(default=None),
    operator_id: int | None = Query(default=None),
    keyword: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    db: Session = Depends(get_db),
):
    try:
        query = QATraceQuery(
            qa_type=qa_type,
            status=status_value,
            trace_id=trace_id,
            operator_id=operator_id,
            keyword=keyword,
            page=page,
            page_size=page_size,
        )
        items, total = qa_trace_service.list_traces(db, query)
        return paginated_response(
            items=[item.model_dump() for item in items],
            total=total,
            page=page,
            page_size=page_size,
            message="ok",
        )
    except Exception as exc:  # noqa: BLE001
        logger.error(f"List QA traces failed: {exc}", exc_info=True)
        return error_response(message="List QA traces failed", code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.get("/cost-summary", summary="QA model cost summary")
async def get_qa_cost_summary(
    qa_type: str | None = Query(default=None),
    status_value: str | None = Query(default=None, alias="status"),
    window_hours: int = Query(default=24, ge=1, le=24 * 90),
    db: Session = Depends(get_db),
):
    try:
        query = QACostSummaryQuery(
            qa_type=qa_type,
            status=status_value,
            window_hours=window_hours,
        )
        item = qa_trace_service.get_cost_summary(db, query)
        return success_response(data=item.model_dump(), message="ok")
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Get QA model cost summary failed: {exc}", exc_info=True)
        return error_response(message="Get QA model cost summary failed", code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.get("/{trace_id_or_pk}", summary="Get QA trace detail")
async def get_qa_trace(
    trace_id_or_pk: str,
    db: Session = Depends(get_db),
):
    try:
        item = qa_trace_service.get_trace(db, trace_id_or_pk)
        if not item:
            return error_response(message="QA trace not found", code=status.HTTP_404_NOT_FOUND)
        return success_response(data=item.model_dump(), message="ok")
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Get QA trace detail failed: {exc}", exc_info=True)
        return error_response(message="Get QA trace detail failed", code=status.HTTP_500_INTERNAL_SERVER_ERROR)