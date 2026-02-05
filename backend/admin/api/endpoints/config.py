"""
配置 API 端点
"""
from fastapi import APIRouter, Depends, Request, Query, status
from sqlalchemy.orm import Session

from ...database import get_db
from ...models import AdminUser
from ...schemas.config import (
    ConfigItem,
    ConfigCreate,
    ConfigUpdate,
    ConfigQuery,
    ConfigBatchUpdate,
)
from ...services import config_service
from ..deps import get_current_user, get_client_ip
from core import (
    success_response,
    error_response,
    paginated_response,
    BusinessException,
    NotFoundException,
    ValidationException,
    get_logger,
)

logger = get_logger()
router = APIRouter(prefix="/admin/config", tags=["配置管理"])


@router.get(
    "",
    summary="获取配置列表",
    description="分页查询配置列表，支持按分类和键过滤"
)
async def get_config_list(
    category: str = Query(None, description="配置分类"),
    key: str = Query(None, description="配置键（模糊匹配）"),
    is_sensitive: bool = Query(None, description="是否敏感"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(10, ge=1, le=100, description="每页大小"),
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    获取配置列表
    
    支持分页和过滤
    """
    try:
        query = ConfigQuery(
            category=category,
            key=key,
            is_sensitive=is_sensitive,
            page=page,
            page_size=page_size
        )
        
        items, total = config_service.get_config_list(db, query)
        
        return paginated_response(
            items=[item.model_dump() for item in items],
            total=total,
            page=page,
            page_size=page_size,
            message="获取成功"
        )
        
    except Exception as e:
        logger.error(f"获取配置列表异常: {str(e)}", exc_info=True)
        return error_response(
            message="获取配置列表失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


# ============================================================
# 特定路由必须放在通配符路由 /{category}/{key} 之前
# ============================================================

@router.get(
    "/openai/models",
    summary="获取可用的 OpenAI 模型列表",
    description="获取可用模型列表"
)
async def get_available_models(
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取可用的 OpenAI 模型列表"""
    try:
        logger.info("开始获取可用模型列表...")
        models = config_service.get_available_openai_models(db)
        logger.info(f"获取到 {len(models)} 个模型")
        return success_response(data={"models": models}, message="获取成功")
    except Exception as e:
        logger.error(f"获取模型列表异常: {str(e)}", exc_info=True)
        return error_response(
            message="获取模型列表失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.get(
    "/openai/all",
    summary="获取 OpenAI 配置",
    description="获取所有 OpenAI 相关配置"
)
async def get_openai_config(
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取 OpenAI 配置"""
    try:
        config = config_service.get_openai_config(db)
        return success_response(data=config, message="获取成功")
    except Exception as e:
        logger.error(f"获取 OpenAI 配置异常: {str(e)}", exc_info=True)
        return error_response(
            message="获取配置失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.get(
    "/nl2cypher/all",
    summary="获取 NL2Cypher 配置",
    description="获取所有 NL2Cypher 相关配置"
)
async def get_nl2cypher_config(
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取 NL2Cypher 配置"""
    try:
        config = config_service.get_nl2cypher_config(db)
        return success_response(data=config, message="获取成功")
    except Exception as e:
        logger.error(f"获取 NL2Cypher 配置异常: {str(e)}", exc_info=True)
        return error_response(
            message="获取配置失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.get(
    "/neo4j/all",
    summary="获取 Neo4j 配置",
    description="获取所有 Neo4j 相关配置"
)
async def get_neo4j_config(
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取 Neo4j 配置"""
    try:
        config = config_service.get_neo4j_config(db)
        return success_response(data=config, message="获取成功")
    except Exception as e:
        logger.error(f"获取 Neo4j 配置异常: {str(e)}", exc_info=True)
        return error_response(
            message="获取配置失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.get(
    "/ai-service/all",
    summary="获取 AI 服务配置",
    description="获取所有 AI 服务相关配置"
)
async def get_ai_service_config(
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取 AI 服务配置"""
    try:
        config = config_service.get_ai_service_config(db)
        return success_response(data=config, message="获取成功")
    except Exception as e:
        logger.error(f"获取 AI 服务配置异常: {str(e)}", exc_info=True)
        return error_response(
            message="获取配置失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


# ============================================================
# 通配符路由必须放在最后
# ============================================================

@router.get(
    "/{category}/{key}",
    summary="获取配置详情",
    description="根据分类和键获取配置详情"
)
async def get_config_detail(
    category: str,
    key: str,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    获取配置详情
    """
    try:
        config = config_service.get_config_item(db, category, key)
        
        return success_response(
            data=config.model_dump(),
            message="获取成功"
        )
        
    except NotFoundException as e:
        return error_response(
            message=e.message,
            code=e.status_code,
            error_code=e.error_code,
            error_type="NotFoundError"
        )
    except Exception as e:
        logger.error(f"获取配置详情异常: {str(e)}", exc_info=True)
        return error_response(
            message="获取配置详情失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.post(
    "",
    summary="创建配置",
    description="创建新的配置项"
)
async def create_config(
    config_create: ConfigCreate,
    request: Request,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    创建配置
    
    - **category**: 配置分类
    - **key**: 配置键
    - **value**: 配置值
    - **description**: 描述（可选）
    - **is_sensitive**: 是否敏感
    """
    try:
        ip_address = get_client_ip(request)
        
        config = config_service.create_config(
            db=db,
            config_create=config_create,
            user=current_user,
            ip_address=ip_address
        )
        
        return success_response(
            data=config.model_dump(),
            message="创建成功",
            code=status.HTTP_201_CREATED
        )
        
    except BusinessException as e:
        return error_response(
            message=e.message,
            code=e.status_code,
            error_code=e.error_code,
            error_type="BusinessError"
        )
    except ValidationException as e:
        return error_response(
            message=e.message,
            code=e.status_code,
            error_code=e.error_code,
            error_type="ValidationError",
            details=e.details
        )
    except Exception as e:
        logger.error(f"创建配置异常: {str(e)}", exc_info=True)
        return error_response(
            message="创建配置失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.put(
    "/{category}/{key}",
    summary="更新配置",
    description="更新指定的配置项"
)
async def update_config(
    category: str,
    key: str,
    config_update: ConfigUpdate,
    request: Request,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    更新配置
    
    - **value**: 新的配置值
    - **description**: 新的描述（可选）
    """
    try:
        ip_address = get_client_ip(request)
        
        config = config_service.update_config(
            db=db,
            category=category,
            key=key,
            config_update=config_update,
            user=current_user,
            ip_address=ip_address
        )
        
        return success_response(
            data=config.model_dump(),
            message="更新成功"
        )
        
    except NotFoundException as e:
        return error_response(
            message=e.message,
            code=e.status_code,
            error_code=e.error_code,
            error_type="NotFoundError"
        )
    except BusinessException as e:
        return error_response(
            message=e.message,
            code=e.status_code,
            error_code=e.error_code,
            error_type="BusinessError"
        )
    except Exception as e:
        logger.error(f"更新配置异常: {str(e)}", exc_info=True)
        return error_response(
            message="更新配置失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.post(
    "/batch",
    summary="批量更新配置",
    description="批量更新多个配置项"
)
async def batch_update_configs(
    batch_update: ConfigBatchUpdate,
    request: Request,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    批量更新配置
    
    - **configs**: 配置列表，每项包含 category, key, value
    """
    try:
        ip_address = get_client_ip(request)
        
        updated_count = config_service.batch_update_configs(
            db=db,
            batch_update=batch_update,
            user=current_user,
            ip_address=ip_address
        )
        
        return success_response(
            data={"updated_count": updated_count, "total": len(batch_update.configs)},
            message=f"批量更新成功，更新了 {updated_count} 个配置"
        )
        
    except BusinessException as e:
        return error_response(
            message=e.message,
            code=e.status_code,
            error_code=e.error_code,
            error_type="BusinessError"
        )
    except Exception as e:
        logger.error(f"批量更新配置异常: {str(e)}", exc_info=True)
        return error_response(
            message="批量更新配置失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.delete(
    "/{category}/{key}",
    summary="删除配置",
    description="删除指定的配置项"
)
async def delete_config(
    category: str,
    key: str,
    request: Request,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    删除配置
    """
    try:
        ip_address = get_client_ip(request)
        
        success = config_service.delete_config(
            db=db,
            category=category,
            key=key,
            user=current_user,
            ip_address=ip_address
        )
        
        if success:
            return success_response(message="删除成功")
        else:
            return error_response(
                message="删除失败",
                code=status.HTTP_400_BAD_REQUEST
            )
            
    except NotFoundException as e:
        return error_response(
            message=e.message,
            code=e.status_code,
            error_code=e.error_code,
            error_type="NotFoundError"
        )
    except Exception as e:
        logger.error(f"删除配置异常: {str(e)}", exc_info=True)
        return error_response(
            message="删除配置失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.post(
    "/init",
    summary="从环境变量初始化配置",
    description="从环境变量初始化所有配置项"
)
async def init_from_env(
    request: Request,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """从环境变量初始化配置"""
    try:
        ip_address = get_client_ip(request)
        count = config_service.init_from_env(db, current_user, ip_address)
        return success_response(
            data={"initialized_count": count},
            message=f"成功初始化 {count} 个配置项"
        )
    except Exception as e:
        logger.error(f"初始化配置异常: {str(e)}", exc_info=True)
        return error_response(
            message="初始化配置失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.post(
    "/test/{service_type}",
    summary="测试服务连接",
    description="测试 Neo4j 或 OpenAI 服务连接"
)
async def test_connection(
    service_type: str,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """测试服务连接"""
    try:
        if service_type == "neo4j":
            result = config_service.test_neo4j_connection(db)
        elif service_type == "openai":
            result = config_service.test_openai_connection(db)
        else:
            return error_response(
                message=f"不支持的服务类型: {service_type}",
                code=status.HTTP_400_BAD_REQUEST
            )
        
        return success_response(data=result, message="测试完成")
    except Exception as e:
        logger.error(f"测试连接异常: {str(e)}", exc_info=True)
        return error_response(
            message="测试连接失败",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )



