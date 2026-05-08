"""
问答链路追踪 API
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from ...database import get_db
from ...schemas.qa_traces import QATraceQuery
from ...services import qa_trace_service
from ..deps import require_admin_permission
from core import error_response, paginated_response, success_response, get_logger

logger = get_logger()

router = APIRouter(
    prefix="/admin/qa-traces",
    tags=["问答链路追踪"],
    dependencies=[Depends(require_admin_permission("monitor:read", resource="qa_trace"))],
)


@router.get("", summary="问答链路追踪列表")
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
            message="获取成功",
        )
    except Exception as exc:  # noqa: BLE001
        logger.error(f"获取问答链路追踪列表异常: {exc}", exc_info=True)
        return error_response(message="获取问答链路追踪列表失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@router.get("/{trace_id_or_pk}", summary="问答链路追踪详情")
async def get_qa_trace(
    trace_id_or_pk: str,
    db: Session = Depends(get_db),
):
    try:
        item = qa_trace_service.get_trace(db, trace_id_or_pk)
        if not item:
            return error_response(message="问答链路追踪不存在", code=status.HTTP_404_NOT_FOUND)
        return success_response(data=item.model_dump(), message="获取成功")
    except Exception as exc:  # noqa: BLE001
        logger.error(f"获取问答链路追踪详情异常: {exc}", exc_info=True)
        return error_response(message="获取问答链路追踪详情失败", code=status.HTTP_500_INTERNAL_SERVER_ERROR)

