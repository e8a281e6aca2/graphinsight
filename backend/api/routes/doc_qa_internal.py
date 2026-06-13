"""Internal capability routes for DocQA."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from api.internal_access import operator_id_from_headers, require_go_capability_request
from api.routes.doc_qa import (
    DeepResearchRequest,
    DocQARequest,
    handle_deep_research,
    handle_doc_qa,
    handle_doc_qa_health,
)
from services.runtime_db import get_runtime_db

internal_router = APIRouter()


@internal_router.post("/internal/docqa", summary="内部文档问答能力入口")
async def internal_doc_qa(
    payload: DocQARequest,
    request: Request,
    db: Session = Depends(get_runtime_db),
):
    denied = require_go_capability_request(request)
    if denied is not None:
        return denied
    return handle_doc_qa(
        payload=payload,
        request=request,
        db=db,
        operator_id=operator_id_from_headers(request),
    )


@internal_router.post("/internal/docqa/deep-research", summary="内部文档深度调研能力入口")
async def internal_doc_qa_deep_research(
    payload: DeepResearchRequest,
    request: Request,
    db: Session = Depends(get_runtime_db),
):
    denied = require_go_capability_request(request)
    if denied is not None:
        return denied
    return handle_deep_research(
        payload=payload,
        request=request,
        db=db,
        operator_id=operator_id_from_headers(request),
    )


@internal_router.get("/internal/docqa/health", summary="内部文档问答健康检查能力入口")
async def internal_doc_qa_health(
    request: Request,
    probe_llm: bool = False,
):
    denied = require_go_capability_request(request)
    if denied is not None:
        return denied
    return handle_doc_qa_health(probe_llm=probe_llm, request=request, internal=True)
