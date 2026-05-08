"""
NL2Cypher API 路由
"""
from typing import Optional, Dict, List

from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel
from services.nl2cypher_service import NL2CypherService
from neo4j.exceptions import ServiceUnavailable
from utils.logger import log_action
from admin.api.deps import require_permission
from admin.models import AdminUser

router = APIRouter()


class NL2CypherRequest(BaseModel):
    """NL2Cypher 请求模型"""
    natural_language: str
    context: Optional[Dict] = None


class NL2CypherResponse(BaseModel):
    """NL2Cypher 响应模型"""
    success: bool
    cypher: Optional[str] = None
    explanation: Optional[str] = None
    confidence: Optional[float] = None
    error: Optional[str] = None
    suggestions: Optional[List[str]] = None


@router.post("/nl2cypher", response_model=NL2CypherResponse)
async def convert_nl_to_cypher(
    nl_request: NL2CypherRequest,
    http_request: Request,
    current_user: Optional[AdminUser] = Depends(require_permission("nl2cypher:use", resource="nl2cypher")),
):
    """
    将自然语言转换为 Cypher 查询
    
    Args:
        nl_request: 包含自然语言查询的请求
        http_request: HTTP 请求对象
        
    Returns:
        包含 Cypher 查询和解释的响应
    """
    if not nl_request.natural_language or not nl_request.natural_language.strip():
        raise HTTPException(status_code=400, detail="自然语言查询不能为空")
    
    try:
        nl2cypher_service = NL2CypherService()
        result = await nl2cypher_service.convert(
            nl_request.natural_language,
            nl_request.context
        )
    except ServiceUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    
    # 记录日志
    if result.get("success"):
        log_action(
            action="nl2cypher_generate",
            resource="ai_query",
            details=f"NL: {nl_request.natural_language[:100]}, Confidence: {result.get('confidence', 0)}",
            user_id=current_user.id if current_user else None,
            ip_address=http_request.client.host if http_request.client else None
        )
    
    return result


@router.get("/nl2cypher/examples")
async def get_examples():
    """
    获取示例查询
    
    Returns:
        示例查询列表
    """
    examples = [
        {
            "nl": "查找所有水稻相关的病虫害",
            "description": "查询特定作物的病虫害"
        },
        {
            "nl": "显示小麦和它的防治方法",
            "description": "查询作物及其防治方法"
        },
        {
            "nl": "找出影响玉米的所有疾病",
            "description": "查询作物的疾病"
        },
        {
            "nl": "查询所有作物和它们的病害数量",
            "description": "统计查询"
        },
        {
            "nl": "显示水稻的完整知识图谱",
            "description": "查询节点的所有关系"
        }
    ]
    
    return {
        "success": True,
        "examples": examples
    }


@router.get("/nl2cypher/status")
async def get_status(
    current_user: Optional[AdminUser] = Depends(require_permission("config:read", resource="system_config")),
):
    """
    获取 NL2Cypher 服务状态
    
    Returns:
        服务状态信息
    """
    from config import get_settings
    settings = get_settings()
    
    # 尝试从数据库获取配置
    try:
        from admin.config_service import ConfigService
        openai_config = ConfigService.get_openai_config()
        nl2cypher_config = ConfigService.get_nl2cypher_config()
        
        return {
            "enabled": nl2cypher_config.get("enabled", settings.nl2cypher_enabled),
            "model": openai_config.get("model", settings.openai_model),
            "api_key_configured": bool(openai_config.get("api_key", settings.openai_api_key)),
            "max_limit": nl2cypher_config.get("max_limit", settings.nl2cypher_max_limit),
            "config_source": "database"
        }
    except Exception as e:
        # 回退到环境变量配置
        import traceback
        print(f"[WARNING] Failed to read database config: {e}")
        traceback.print_exc()
        return {
            "enabled": settings.nl2cypher_enabled,
            "model": settings.openai_model,
            "api_key_configured": bool(settings.openai_api_key),
            "max_limit": settings.nl2cypher_max_limit,
            "config_source": "environment",
            "error": str(e)
        }
