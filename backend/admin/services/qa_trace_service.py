"""
问答链路追踪服务
"""
from __future__ import annotations

import json
from typing import Any, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..models import AdminQATrace
from ..schemas.qa_traces import QATraceCreate, QATraceDetail, QATraceItem, QATraceQuery
from core import get_logger

logger = get_logger()


def _to_json_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return json.dumps({"raw": str(value)}, ensure_ascii=False)


def _from_json_text(value: Optional[str]) -> Any:
    if not value:
        return None
    try:
        return json.loads(value)
    except Exception:
        return value


class QATraceService:
    def create_trace(self, db: Session, payload: QATraceCreate) -> Optional[QATraceItem]:
        try:
            row = AdminQATrace(
                trace_id=payload.trace_id,
                qa_type=payload.qa_type,
                status=payload.status,
                question=payload.question[:4000],
                operator_id=payload.operator_id,
                model=payload.model,
                top_k=payload.top_k,
                latency_ms=payload.latency_ms,
                retrieval_count=payload.retrieval_count,
                citation_count=payload.citation_count,
                answer_preview=(payload.answer_preview or "")[:2000] if payload.answer_preview else None,
                retrieval_snapshot=_to_json_text(payload.retrieval_snapshot),
                generation_snapshot=_to_json_text(payload.generation_snapshot),
                response_snapshot=_to_json_text(payload.response_snapshot),
                error_message=(payload.error_message or "")[:2000] if payload.error_message else None,
            )
            db.add(row)
            db.commit()
            db.refresh(row)
            return QATraceItem.model_validate(row)
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            logger.warning("问答链路追踪写入失败", context={"error": str(exc)})
            return None

    def list_traces(self, db: Session, query: QATraceQuery) -> tuple[list[QATraceItem], int]:
        filters = []
        if query.qa_type:
            filters.append(AdminQATrace.qa_type == query.qa_type)
        if query.status:
            filters.append(AdminQATrace.status == query.status)
        if query.trace_id:
            filters.append(AdminQATrace.trace_id == query.trace_id)
        if query.operator_id:
            filters.append(AdminQATrace.operator_id == query.operator_id)
        if query.keyword:
            pattern = f"%{query.keyword}%"
            filters.append(or_(AdminQATrace.question.ilike(pattern), AdminQATrace.answer_preview.ilike(pattern)))

        base = db.query(AdminQATrace)
        if filters:
            base = base.filter(*filters)

        total = base.count()
        rows = (
            base.order_by(AdminQATrace.created_at.desc())
            .offset((query.page - 1) * query.page_size)
            .limit(query.page_size)
            .all()
        )
        return [QATraceItem.model_validate(row) for row in rows], total

    def get_trace(self, db: Session, trace_id_or_pk: str) -> Optional[QATraceDetail]:
        row = None
        if str(trace_id_or_pk).isdigit():
            row = db.query(AdminQATrace).filter(AdminQATrace.id == int(trace_id_or_pk)).first()
        if row is None:
            row = db.query(AdminQATrace).filter(AdminQATrace.trace_id == trace_id_or_pk).first()
        if row is None:
            return None

        item = QATraceDetail.model_validate(row)
        item.retrieval_snapshot = _from_json_text(row.retrieval_snapshot)
        item.generation_snapshot = _from_json_text(row.generation_snapshot)
        item.response_snapshot = _from_json_text(row.response_snapshot)
        return item


qa_trace_service = QATraceService()

