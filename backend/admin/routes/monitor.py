"""
系统监控路由
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from neo4j import GraphDatabase
import time
from datetime import datetime, timedelta
from ..database import get_db
from ..models import AdminUser, AdminConfig, AdminLog
from ..schemas import MonitorStatus, MonitorStats, ServiceStatus
from ..auth import get_current_user
from services.openai_client_factory import build_openai_client

router = APIRouter(prefix="/admin/monitor", tags=["admin-monitor"])


@router.get("/status", response_model=MonitorStatus)
async def get_service_status(
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取服务状态"""
    # Neo4j 状态
    neo4j_status = ServiceStatus(status="unknown")
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
        
        if all([uri_config, user_config, password_config]):
            start_time = time.time()
            driver = GraphDatabase.driver(
                uri_config.value,
                auth=(user_config.value, password_config.value)
            )
            driver.verify_connectivity()
            driver.close()
            latency = (time.time() - start_time) * 1000
            neo4j_status = ServiceStatus(
                status="connected",
                message="连接正常",
                latency=round(latency, 2)
            )
        else:
            neo4j_status = ServiceStatus(status="not_configured", message="未配置")
    except Exception as e:
        neo4j_status = ServiceStatus(status="error", message=str(e))
    
    # OpenAI 状态
    openai_status = ServiceStatus(status="unknown")
    try:
        api_key_config = db.query(AdminConfig).filter(
            AdminConfig.category == "openai",
            AdminConfig.key == "api_key"
        ).first()
        base_url_config = db.query(AdminConfig).filter(
            AdminConfig.category == "openai",
            AdminConfig.key == "base_url"
        ).first()
        
        if api_key_config and api_key_config.value:
            # 创建客户端，支持自定义 base_url
            client_kwargs = {"api_key": api_key_config.value}
            if base_url_config and base_url_config.value:
                client_kwargs["base_url"] = base_url_config.value
            
            client = build_openai_client(
                api_key=client_kwargs["api_key"],
                base_url=client_kwargs.get("base_url"),
                timeout=20.0,
            )
            client.models.list()
            openai_status = ServiceStatus(status="configured", message="API 可用")
        else:
            openai_status = ServiceStatus(status="not_configured", message="未配置")
    except Exception as e:
        openai_status = ServiceStatus(status="error", message=str(e))
    
    # 后端状态
    backend_status = ServiceStatus(
        status="running",
        message="服务正常"
    )
    
    return MonitorStatus(
        neo4j=neo4j_status,
        openai=openai_status,
        backend=backend_status
    )


@router.get("/stats", response_model=MonitorStats)
async def get_stats(
    current_user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取统计数据"""
    # 统计最近 24 小时的日志
    since = datetime.utcnow() - timedelta(hours=24)
    
    # API 调用次数（所有操作）
    api_calls = db.query(AdminLog).filter(
        AdminLog.created_at >= since
    ).count()
    
    # 查询执行次数（精确匹配 query_execute）
    queries = db.query(AdminLog).filter(
        AdminLog.created_at >= since,
        AdminLog.action == "query_execute"
    ).count()
    
    # AI 生成次数（精确匹配 nl2cypher_generate）
    ai_generations = db.query(AdminLog).filter(
        AdminLog.created_at >= since,
        AdminLog.action == "nl2cypher_generate"
    ).count()
    
    return MonitorStats(
        api_calls=api_calls,
        queries=queries,
        ai_generations=ai_generations
    )


@router.get("/health")
async def health_check():
    """健康检查"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat()
    }
