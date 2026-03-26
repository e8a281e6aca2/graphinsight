"""
监控服务
处理系统监控、健康检查等业务逻辑
"""
import time
from datetime import datetime
from typing import Dict, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text

try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False

from ..database import engine
from ..schemas.monitor import (
    SystemStats,
    HealthStatus,
    DatabaseStatus,
    Neo4jStatus,
    AIServiceStatus,
)
from core import get_logger, SystemException

logger = get_logger()

# 应用启动时间
_start_time = time.time()


class MonitorService:
    """监控服务类"""
    
    def __init__(self):
        self.start_time = _start_time
    
    def get_system_stats(self) -> SystemStats:
        """获取系统统计信息"""
        if not PSUTIL_AVAILABLE:
            logger.warning("psutil 未安装，返回模拟数据")
            return SystemStats(
                cpu_percent=0.0,
                memory_percent=0.0,
                memory_used_mb=0.0,
                memory_total_mb=0.0,
                disk_percent=0.0,
                disk_used_gb=0.0,
                disk_total_gb=0.0,
                uptime_seconds=round(time.time() - self.start_time, 2),
                timestamp=datetime.utcnow()
            )
        
        try:
            # CPU 使用率
            cpu_percent = psutil.cpu_percent(interval=0.1)
            
            # 内存信息
            memory = psutil.virtual_memory()
            memory_percent = memory.percent
            memory_used_mb = memory.used / (1024 * 1024)
            memory_total_mb = memory.total / (1024 * 1024)
            
            # 磁盘信息
            disk = psutil.disk_usage('/')
            disk_percent = disk.percent
            disk_used_gb = disk.used / (1024 * 1024 * 1024)
            disk_total_gb = disk.total / (1024 * 1024 * 1024)
            
            # 运行时间
            uptime_seconds = time.time() - self.start_time
            
            return SystemStats(
                cpu_percent=round(cpu_percent, 2),
                memory_percent=round(memory_percent, 2),
                memory_used_mb=round(memory_used_mb, 2),
                memory_total_mb=round(memory_total_mb, 2),
                disk_percent=round(disk_percent, 2),
                disk_used_gb=round(disk_used_gb, 2),
                disk_total_gb=round(disk_total_gb, 2),
                uptime_seconds=round(uptime_seconds, 2),
                timestamp=datetime.utcnow()
            )
        except Exception as e:
            logger.error(f"获取系统统计失败: {str(e)}", exc_info=True)
            raise SystemException("获取系统统计失败")
    
    def check_database_status(self, db: Session) -> DatabaseStatus:
        """检查数据库状态"""
        try:
            # 尝试执行简单查询
            result = db.execute(text("SELECT 1")).scalar()
            
            if result == 1:
                # 获取表数量
                tables_result = db.execute(text(
                    "SELECT COUNT(*) FROM information_schema.tables "
                    "WHERE table_schema = 'public'"
                )).scalar()
                
                return DatabaseStatus(
                    connected=True,
                    database=engine.url.database or "unknown",
                    tables_count=tables_result,
                    error=None
                )
            else:
                return DatabaseStatus(
                    connected=False,
                    database=engine.url.database or "unknown",
                    tables_count=None,
                    error="查询返回异常结果"
                )
        except Exception as e:
            logger.error(f"数据库检查失败: {str(e)}")
            return DatabaseStatus(
                connected=False,
                database=engine.url.database or "unknown",
                tables_count=None,
                error=str(e)
            )
    
    def check_neo4j_status(self, db: Session) -> Neo4jStatus:
        """检查 Neo4j 状态"""
        try:
            from services.neo4j_service import get_neo4j_service
            from .config_service import config_service
            
            # 获取 Neo4j 配置
            neo4j_config = config_service.get_neo4j_config(db)
            uri = neo4j_config.get("uri", "bolt://localhost:7687")
            database = neo4j_config.get("database", "neo4j")
            
            # 尝试连接并获取统计
            try:
                neo4j_service = get_neo4j_service()
                
                # 直接使用driver执行简单查询
                with neo4j_service.driver.session() as session:
                    # 获取节点数量
                    result = session.run("MATCH (n) RETURN count(n) as count")
                    record = result.single()
                    nodes_count = record["count"] if record else 0
                    
                    # 获取关系数量
                    result2 = session.run("MATCH ()-[r]->() RETURN count(r) as count")
                    record2 = result2.single()
                    relationships_count = record2["count"] if record2 else 0
                
                return Neo4jStatus(
                    connected=True,
                    uri=uri,
                    database=database,
                    nodes_count=nodes_count,
                    relationships_count=relationships_count,
                    error=None
                )
            except Exception as e:
                logger.error(f"Neo4j 查询失败: {str(e)}")
                return Neo4jStatus(
                    connected=False,
                    uri=uri,
                    database=database,
                    nodes_count=None,
                    relationships_count=None,
                    error=str(e)
                )
        except Exception as e:
            logger.error(f"Neo4j 检查失败: {str(e)}")
            return Neo4jStatus(
                connected=False,
                uri="unknown",
                database="unknown",
                nodes_count=None,
                relationships_count=None,
                error=str(e)
            )
    
    def check_ai_service_status(self, db: Session) -> AIServiceStatus:
        """检查AI服务状态"""
        try:
            from .config_service import config_service
            
            # 获取AI服务配置
            provider = config_service.get_config(db, "ai_service", "provider", "openai")
            enabled = config_service.get_config(db, "ai_service", "enabled", "true").lower() == "true"
            api_key = config_service.get_config(db, "ai_service", "api_key", "")
            model = config_service.get_config(db, "ai_service", "model", "gpt-3.5-turbo")
            
            # 检查是否启用
            if not enabled:
                return AIServiceStatus(
                    connected=False,
                    service_name=provider.upper(),
                    model=model,
                    api_key_configured=False,
                    error="AI服务未启用"
                )
            
            # 检查API Key是否配置
            api_key_configured = bool(api_key and api_key.strip() and api_key != "your-api-key-here")
            
            if not api_key_configured:
                return AIServiceStatus(
                    connected=False,
                    service_name=provider.upper(),
                    model=model,
                    api_key_configured=False,
                    error="API Key未配置"
                )
            
            # 根据不同的 provider 检查格式
            if provider == "openai":
                if api_key.startswith("sk-"):
                    return AIServiceStatus(
                        connected=True,
                        service_name="OpenAI",
                        model=model,
                        api_key_configured=True,
                        error=None
                    )
                else:
                    return AIServiceStatus(
                        connected=False,
                        service_name="OpenAI",
                        model=model,
                        api_key_configured=True,
                        error="API Key格式不正确（应以 sk- 开头）"
                    )
            elif provider == "claude":
                if api_key.startswith("sk-ant-"):
                    return AIServiceStatus(
                        connected=True,
                        service_name="Claude",
                        model=model,
                        api_key_configured=True,
                        error=None
                    )
                else:
                    return AIServiceStatus(
                        connected=False,
                        service_name="Claude",
                        model=model,
                        api_key_configured=True,
                        error="API Key格式不正确（应以 sk-ant- 开头）"
                    )
            else:
                # 其他 provider，只检查是否配置
                return AIServiceStatus(
                    connected=True,
                    service_name=provider.upper(),
                    model=model,
                    api_key_configured=True,
                    error=None
                )
        except Exception as e:
            logger.error(f"AI服务检查失败: {str(e)}")
            return AIServiceStatus(
                connected=False,
                service_name="Unknown",
                model=None,
                api_key_configured=False,
                error=str(e)
            )
    
    def get_health_status(self, db: Session) -> HealthStatus:
        """获取健康状态"""
        try:
            # 检查数据库
            database_status = self.check_database_status(db)
            
            # 检查 Neo4j
            neo4j_status = self.check_neo4j_status(db)
            
            # 检查AI服务
            ai_service_status = self.check_ai_service_status(db)
            
            # 获取系统统计
            try:
                system_stats = self.get_system_stats()
            except:
                system_stats = None
            
            # 检查项
            checks = {
                "database": database_status.connected,
                "neo4j": neo4j_status.connected,
                "ai_service": ai_service_status.connected,
                "disk_space": system_stats.disk_percent < 90 if system_stats else True,
                "memory": system_stats.memory_percent < 90 if system_stats else True,
            }
            
            # 确定整体状态
            if all(checks.values()):
                status = "healthy"
            elif any(checks.values()):
                status = "degraded"
            else:
                status = "unhealthy"
            
            return HealthStatus(
                status=status,
                timestamp=datetime.utcnow(),
                database=database_status,
                neo4j=neo4j_status,
                ai_service=ai_service_status,
                system=system_stats,
                checks=checks
            )
        except Exception as e:
            logger.error(f"获取健康状态失败: {str(e)}", exc_info=True)
            raise SystemException("获取健康状态失败")
    
    def get_performance_metrics(self) -> Dict:
        """获取性能指标（占位符，需要实际实现）"""
        # TODO: 实现性能指标收集
        return {
            "avg_response_time_ms": 0,
            "p95_response_time_ms": 0,
            "p99_response_time_ms": 0,
            "requests_per_second": 0,
            "error_rate": 0,
            "total_requests": 0,
            "failed_requests": 0,
            "timestamp": datetime.utcnow()
        }


# 创建全局实例
monitor_service = MonitorService()
