"""
客户端日志上报 API
用于记录前端运行时错误到后端日志系统
"""
from typing import Optional, Dict, Any, Literal
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from core import success_response, get_logger

router = APIRouter()
logger = get_logger()


class ClientLogPayload(BaseModel):
    level: Literal['info', 'warn', 'error'] = Field('info', description='日志级别')
    message: str = Field(..., min_length=1, max_length=1000, description='日志消息')
    context: Optional[Dict[str, Any]] = Field(default=None, description='上下文信息')
    source: Optional[str] = Field(default=None, max_length=100, description='来源模块')
    event: Optional[str] = Field(default=None, max_length=100, description='事件名称')


@router.post(
    "/client-logs",
    summary="客户端日志上报",
    description="接收前端日志并写入后端日志系统",
)
async def report_client_log(payload: ClientLogPayload, request: Request):
    context: Dict[str, Any] = {
        "source": payload.source or "frontend",
        "event": payload.event or "client_log",
    }
    if payload.context:
        context["context"] = payload.context

    if request.client:
        context["ip"] = request.client.host
    user_agent = request.headers.get("user-agent")
    if user_agent:
        context["user_agent"] = user_agent

    # 写入结构化日志文件
    if payload.level == "error":
        logger.error(payload.message, context=context)
    elif payload.level == "warn":
        logger.warning(payload.message, context=context)
    else:
        logger.info(payload.message, context=context)

    return success_response(data={"received": True}, message="logged")
