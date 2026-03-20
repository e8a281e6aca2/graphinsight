"""
文档问答 API
返回带引用摘要的回答
"""
from typing import List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

from core import success_response, error_response, get_logger
from services.doc_qa_service import doc_qa_service

router = APIRouter()
logger = get_logger()


class CitationItem(BaseModel):
    id: str
    title: str
    snippet: str
    location: Optional[str] = None


class DocQARequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    top_k: int = Field(2, ge=1, le=5)
    require_citation: bool = Field(True)


class DocQAResponse(BaseModel):
    answer: str
    citations: List[CitationItem]


@router.post(
    "/docqa",
    summary="文档问答",
    description="基于文档库进行问答并返回引用摘要",
)
async def doc_qa(payload: DocQARequest):
    try:
        result = doc_qa_service.answer(payload.question, payload.top_k)
        citations = [
            CitationItem(
                id=item["id"],
                title=item["title"],
                snippet=item.get("snippet") or item.get("text", "")[:140],
                location=item.get("location"),
            )
            for item in result.get("citations", [])
        ]
        response = DocQAResponse(answer=result.get("answer", ""), citations=citations)
        logger.info(
            "文档问答请求",
            context={"question": payload.question, "citations": len(citations)},
        )
        return success_response(data=response.model_dump(), message="ok")
    except Exception as exc:  # noqa: BLE001
        logger.error("文档问答失败", context={"error": str(exc)})
        return error_response(message="问答失败", code=500)
