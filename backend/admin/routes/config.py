"""
配置管理路由
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from typing import Dict, Any
import os
from neo4j import GraphDatabase
from ..database import get_db
from ..models import AdminUser, AdminConfig, AdminLog
from ..schemas import ConfigUpdate, ConfigResponse, ConfigTest
from ..auth import get_current_user
from services.openai_client_factory import build_openai_client

router = APIRouter(prefix="/admin/config", tags=["admin-config"])


def mask_sensitive_value(value: str, is_sensitive: bool) -> str:
    """遮蔽敏感信息"""
    if not is_sensitive:
        return value
    if len(value) <= 8:
        return "***"
    return f"{value[:3]}***{value[-3:]}"


@router.get("")
async def get_all_configs(
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """获取所有配置"""
    configs = db.query(AdminConfig).all()
    
    # 按分类组织配置
    result = {
        "neo4j": {},
        "openai": {},
        "nl2cypher": {}
    }
    
    for config in configs:
        value = mask_sensitive_value(config.value, config.is_sensitive)
        result[config.category][config.key] = {
            "value": value,
            "description": config.description,
            "is_sensitive": config.is_sensitive
        }
    
    return result


@router.put("")
async def update_config(
    config_update: ConfigUpdate,
    request: Request,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """更新配置"""
    # 查找配置
    config = db.query(AdminConfig).filter(
        AdminConfig.category == config_update.category,
        AdminConfig.key == config_update.key
    ).first()
    
    old_value = config.value if config else None
    
    if config:
        config.value = config_update.value
        config.updated_by = current_user.id
    else:
        # 创建新配置
        config = AdminConfig(
            category=config_update.category,
            key=config_update.key,
            value=config_update.value,
            updated_by=current_user.id
        )
        db.add(config)
    
    db.commit()
    
    # 记录日志
    log = AdminLog(
        user_id=current_user.id,
        action="update_config",
        resource=f"{config_update.category}.{config_update.key}",
        details=f"更新配置: {config_update.category}.{config_update.key}",
        ip_address=request.client.host if request.client else None
    )
    db.add(log)
    db.commit()
    
    return {"message": "配置更新成功"}


@router.post("/test")
async def test_config(
    config_test: ConfigTest,
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """测试配置"""
    if config_test.type == "neo4j":
        # 测试 Neo4j 连接
        try:
            uri_config = db.query(AdminConfig).filter(
                AdminConfig.category == "neo4j",
                AdminConfig.key == "uri"
            ).first()
            user_config = db.query(AdminConfig).filter(
                AdminConfig.category == "neo4j",
                AdminConfig.key == "user"
            ).first()
            password_config = db.query(AdminConfig).filter(
                AdminConfig.category == "neo4j",
                AdminConfig.key == "password"
            ).first()
            
            if not all([uri_config, user_config, password_config]):
                raise HTTPException(status_code=400, detail="Neo4j 配置不完整")
            
            driver = GraphDatabase.driver(
                uri_config.value,
                auth=(user_config.value, password_config.value)
            )
            driver.verify_connectivity()
            driver.close()
            
            return {"success": True, "message": "Neo4j 连接成功"}
        except Exception as e:
            return {"success": False, "message": f"Neo4j 连接失败: {str(e)}"}
    
    elif config_test.type == "openai":
        # 测试 OpenAI API
        try:
            api_key_config = db.query(AdminConfig).filter(
                AdminConfig.category == "openai",
                AdminConfig.key == "api_key"
            ).first()
            base_url_config = db.query(AdminConfig).filter(
                AdminConfig.category == "openai",
                AdminConfig.key == "base_url"
            ).first()
            
            if not api_key_config:
                raise HTTPException(status_code=400, detail="OpenAI API Key 未配置")
            
            # 创建客户端，支持自定义 base_url
            client_kwargs = {"api_key": api_key_config.value}
            if base_url_config and base_url_config.value:
                client_kwargs["base_url"] = base_url_config.value
            
            client = build_openai_client(
                api_key=client_kwargs["api_key"],
                base_url=client_kwargs.get("base_url"),
                timeout=20.0,
            )
            # 简单测试
            response = client.models.list()
            
            return {"success": True, "message": "OpenAI API 连接成功"}
        except Exception as e:
            return {"success": False, "message": f"OpenAI API 连接失败: {str(e)}"}
    
    else:
        raise HTTPException(status_code=400, detail="不支持的测试类型")


@router.get("/openai/models")
async def get_openai_models(
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取 OpenAI 可用模型列表"""
    try:
        api_key_config = db.query(AdminConfig).filter(
            AdminConfig.category == "openai",
            AdminConfig.key == "api_key"
        ).first()
        base_url_config = db.query(AdminConfig).filter(
            AdminConfig.category == "openai",
            AdminConfig.key == "base_url"
        ).first()
        
        if not api_key_config or not api_key_config.value:
            raise HTTPException(status_code=400, detail="请先配置 OpenAI API Key")
        
        # 创建客户端
        client_kwargs = {"api_key": api_key_config.value}
        if base_url_config and base_url_config.value:
            client_kwargs["base_url"] = base_url_config.value
        
        client = build_openai_client(
            api_key=client_kwargs["api_key"],
            base_url=client_kwargs.get("base_url"),
            timeout=20.0,
        )
        
        # 获取模型列表
        models_response = client.models.list()
        models = [model.id for model in models_response.data]
        
        # 过滤出常用的聊天模型
        chat_models = [m for m in models if any(x in m.lower() for x in ['gpt', 'claude', 'qwen', 'glm', 'deepseek'])]
        
        return {
            "success": True,
            "models": sorted(chat_models) if chat_models else sorted(models)[:20],  # 最多返回20个
            "total": len(models)
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"获取模型列表失败: {str(e)}",
            "models": []
        }


@router.post("/init")
async def init_configs(
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """初始化配置（从环境变量）"""
    from dotenv import load_dotenv
    load_dotenv()
    
    configs_to_init = [
        # Neo4j
        ("neo4j", "uri", os.getenv("NEO4J_URI", "bolt://localhost:7687"), "Neo4j 连接 URI", False),
        ("neo4j", "user", os.getenv("NEO4J_USER", "neo4j"), "Neo4j 用户名", False),
        ("neo4j", "password", os.getenv("NEO4J_PASSWORD", ""), "Neo4j 密码", True),
        # OpenAI
        ("openai", "base_url", os.getenv("OPENAI_BASE_URL", ""), "OpenAI API 地址（可选）", False),
        ("openai", "api_key", os.getenv("OPENAI_API_KEY", ""), "OpenAI API Key", True),
        ("openai", "model", os.getenv("OPENAI_MODEL", "gpt-3.5-turbo"), "OpenAI 模型", False),
        ("openai", "max_tokens", os.getenv("OPENAI_MAX_TOKENS", "500"), "最大 Token 数", False),
        ("openai", "temperature", os.getenv("OPENAI_TEMPERATURE", "0.1"), "Temperature", False),
        # NL2Cypher
        ("nl2cypher", "enabled", os.getenv("NL2CYPHER_ENABLED", "true"), "是否启用", False),
        ("nl2cypher", "cache_size", os.getenv("NL2CYPHER_CACHE_SIZE", "100"), "缓存大小", False),
        ("nl2cypher", "max_limit", os.getenv("NL2CYPHER_MAX_LIMIT", "100"), "最大限制", False),
    ]
    
    for category, key, value, description, is_sensitive in configs_to_init:
        existing = db.query(AdminConfig).filter(
            AdminConfig.category == category,
            AdminConfig.key == key
        ).first()
        
        if not existing:
            config = AdminConfig(
                category=category,
                key=key,
                value=value,
                description=description,
                is_sensitive=is_sensitive,
                updated_by=current_user.id
            )
            db.add(config)
    
    db.commit()
    return {"message": "配置初始化成功"}
