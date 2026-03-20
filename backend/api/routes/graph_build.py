"""
图谱构建 API
用于触发基于文档的一键建图
"""
import time
from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

from core import success_response, error_response, get_logger
from services.document_graph_service import document_graph_service

router = APIRouter()
logger = get_logger()


class GraphBuildRequest(BaseModel):
    source: str = Field("documents", description="构建来源")
    force: bool = Field(False, description="是否强制重建")
    note: Optional[str] = Field(default=None, description="备注")


@router.post(
    "/graph/build",
    summary="触发文档图谱构建",
    description="根据已上传文档触发一键建图",
)
async def build_graph(payload: GraphBuildRequest):
    try:
        job_id = f"build-{int(time.time() * 1000)}"
        stats = document_graph_service.build_graph(force=payload.force)
        logger.info(
            "触发一键建图",
            context={
                "job_id": job_id,
                "source": payload.source,
                "force": payload.force,
                "note": payload.note,
                "stats": stats,
            },
        )
        status = "completed" if stats.get("documents", 0) > 0 else "empty"
        message = "构建完成" if status == "completed" else "未发现可解析文档"
        return success_response(
            data={
                "job_id": job_id,
                "status": status,
                "message": message,
                "stats": stats,
            },
            message="已触发建图",
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("建图触发失败", context={"error": str(exc)})
        return error_response(message="建图触发失败", code=500)
