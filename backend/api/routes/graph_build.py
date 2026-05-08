"""
图谱构建 API
用于触发基于文档的一键建图
"""
import time
from typing import List, Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from core import success_response, error_response, get_logger
from services.document_graph_service import DocumentGraphService
from neo4j.exceptions import ServiceUnavailable
from admin.api.deps import require_permission
from admin.models import AdminUser

router = APIRouter()
logger = get_logger()


class GraphBuildRequest(BaseModel):
    source: str = Field("documents", description="构建来源")
    force: bool = Field(False, description="是否强制重建")
    note: Optional[str] = Field(default=None, description="备注")
    doc_ids: List[str] = Field(default_factory=list, description="指定建图的文档 ID 列表")


@router.post(
    "/graph/build",
    summary="触发文档图谱构建",
    description="根据已上传文档触发一键建图",
)
async def build_graph(
    payload: GraphBuildRequest,
    current_user: Optional[AdminUser] = Depends(require_permission("graph:build", resource="graph")),
):
    try:
        job_id = f"build-{int(time.time() * 1000)}"
        service = DocumentGraphService()
        doc_ids = [item.strip() for item in payload.doc_ids if item and item.strip()]
        stats = service.build_graph(force=payload.force, doc_ids=doc_ids or None)
        failures = stats.get("failures", [])
        logger.info(
            "触发一键建图",
            context={
                "job_id": job_id,
                "source": payload.source,
                "force": payload.force,
                "note": payload.note,
                "doc_ids": doc_ids,
                "stats": stats,
            },
        )
        processed = stats.get("documents", 0)
        total = stats.get("total_documents", 0)
        skipped = stats.get("skipped_documents", 0)

        status = "completed" if processed > 0 else "empty"
        if processed > 0:
            message = "构建完成"
        elif total > 0 and skipped == total:
            status = "completed"
            message = "文档未变更，已跳过"
        elif failures:
            message = "解析失败，未产出图谱"
        else:
            message = "未发现可解析文档"
        return success_response(
            data={
                "job_id": job_id,
                "status": status,
                "message": message,
                "doc_ids": doc_ids,
                "stats": stats,
                "failures": failures,
            },
            message="已触发建图",
        )
    except ServiceUnavailable as exc:
        logger.error("Neo4j 不可用，建图失败", context={"error": str(exc)})
        return error_response(message="Neo4j 不可用，请稍后重试", code=503)
    except Exception as exc:  # noqa: BLE001
        logger.error("建图触发失败", context={"error": str(exc)})
        return error_response(message="建图触发失败", code=500)
