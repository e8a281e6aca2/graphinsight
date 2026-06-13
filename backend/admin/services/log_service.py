"""
日志服务
处理日志查询、统计等业务逻辑
"""
import csv
import io
import json
from typing import List, Tuple, Optional, Dict
from datetime import datetime, timedelta
from sqlalchemy.orm import Session

from ..crud import log_crud
from ..crud.log import classify_log_severity
from ..schemas.logs import (
    LogItem,
    LogDetail,
    LogQuery,
    LogStats,
    LogCreate,
)
from core import get_logger, BusinessException, NotFoundException

logger = get_logger()


class LogService:
    """日志服务类"""

    def get_log_by_id(self, db: Session, log_id: int) -> LogDetail:
        """根据 ID 获取日志详情"""
        try:
            log = log_crud.get_by_id(db, log_id)
            if not log:
                raise NotFoundException(f"日志不存在: {log_id}")

            details_dict = None
            if log.details:
                try:
                    details_dict = json.loads(log.details)
                except:
                    details_dict = {"raw": log.details}

            # 获取用户名（如果有）
            username = None
            if log.user_id:
                from ..crud import user_crud
                user = user_crud.get_by_id(db, log.user_id)
                if user:
                    username = user.username

            return LogDetail(
                id=log.id,
                user_id=log.user_id,
                operator_id=log.operator_id,
                tenant_id=log.tenant_id,
                trace_id=log.trace_id,
                username=username,
                action=log.action,
                resource=log.resource,
                resource_id=log.resource_id,
                details=details_dict,
                ip_address=log.ip_address,
                user_agent=log.user_agent,
                status=log.status,
                severity=classify_log_severity(
                    status=log.status,
                    action=log.action,
                    error_message=log.error_message,
                ),
                error_message=log.error_message,
                created_at=log.created_at
            )
        except NotFoundException:
            raise
        except Exception as e:
            logger.error(f"获取日志详情失败: {str(e)}", exc_info=True)
            raise BusinessException("获取日志详情失败")

    def get_log_list(
        self,
        db: Session,
        query: LogQuery
    ) -> Tuple[List[LogItem], int]:
        """获取日志列表"""
        try:
            items, total = log_crud.get_list(db, query)

            # 转换为 Pydantic 模型
            log_items = []
            for item in items:
                log_item = LogItem(
                    id=item["id"],
                    user_id=item["user_id"],
                    operator_id=item.get("operator_id"),
                    tenant_id=item.get("tenant_id"),
                    trace_id=item.get("trace_id"),
                    username=item["username"],
                    action=item["action"],
                    resource=item["resource"],
                    resource_id=item["resource_id"],
                    details=item["details"],
                    ip_address=item["ip_address"],
                    user_agent=item["user_agent"],
                    status=item["status"],
                    severity=item.get("severity") or classify_log_severity(
                        status=item["status"],
                        action=item["action"],
                        error_message=item["error_message"],
                    ),
                    error_message=item["error_message"],
                    created_at=item["created_at"]
                )
                log_items.append(log_item)

            return log_items, total
        except Exception as e:
            logger.error(f"获取日志列表失败: {str(e)}", exc_info=True)
            raise BusinessException("获取日志列表失败")

    def create_log(self, db: Session, log_create: LogCreate) -> LogItem:
        """创建日志"""
        try:
            log = log_crud.create(db, log_create)

            # 获取用户名
            username = None
            if log.user_id:
                from ..crud import user_crud
                user = user_crud.get_by_id(db, log.user_id)
                if user:
                    username = user.username

            return LogItem(
                id=log.id,
                user_id=log.user_id,
                operator_id=log.operator_id,
                tenant_id=log.tenant_id,
                trace_id=log.trace_id,
                username=username,
                action=log.action,
                resource=log.resource,
                resource_id=log.resource_id,
                details=log.details,
                ip_address=log.ip_address,
                user_agent=log.user_agent,
                status=log.status,
                severity=classify_log_severity(
                    status=log.status,
                    action=log.action,
                    error_message=log.error_message,
                ),
                error_message=log.error_message,
                created_at=log.created_at
            )
        except Exception as e:
            logger.error(f"创建日志失败: {str(e)}", exc_info=True)
            raise BusinessException("创建日志失败")

    def get_log_stats(
        self,
        db: Session,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> LogStats:
        """获取日志统计"""
        try:
            # 默认统计最近 7 天
            if not start_date:
                start_date = datetime.utcnow() - timedelta(days=7)
            if not end_date:
                end_date = datetime.utcnow()

            stats_dict = log_crud.get_stats(db, start_date, end_date)

            return LogStats(**stats_dict)
        except Exception as e:
            logger.error(f"获取日志统计失败: {str(e)}", exc_info=True)
            raise BusinessException("获取日志统计失败")

    def get_recent_logs(
        self,
        db: Session,
        limit: int = 10,
        action: Optional[str] = None
    ) -> List[LogItem]:
        """获取最近的日志"""
        try:
            query = LogQuery(
                action=action,
                page=1,
                page_size=limit
            )
            items, _ = self.get_log_list(db, query)
            return items
        except Exception as e:
            logger.error(f"获取最近日志失败: {str(e)}", exc_info=True)
            raise BusinessException("获取最近日志失败")

    def get_user_logs(
        self,
        db: Session,
        user_id: int,
        page: int = 1,
        page_size: int = 20
    ) -> Tuple[List[LogItem], int]:
        """获取用户的日志"""
        try:
            query = LogQuery(
                user_id=user_id,
                page=page,
                page_size=page_size
            )
            return self.get_log_list(db, query)
        except Exception as e:
            logger.error(f"获取用户日志失败: {str(e)}", exc_info=True)
            raise BusinessException("获取用户日志失败")

    def get_failed_logs(
        self,
        db: Session,
        page: int = 1,
        page_size: int = 20,
        start_date: Optional[datetime] = None
    ) -> Tuple[List[LogItem], int]:
        """获取失败的日志"""
        try:
            query = LogQuery(
                status="failed",
                start_date=start_date,
                page=page,
                page_size=page_size
            )
            return self.get_log_list(db, query)
        except Exception as e:
            logger.error(f"获取失败日志失败: {str(e)}", exc_info=True)
            raise BusinessException("获取失败日志失败")

    def clean_old_logs(self, db: Session, days: int = 90) -> int:
        """清理旧日志"""
        try:
            deleted_count = log_crud.delete_old_logs(db, days)

            logger.info(
                f"清理旧日志完成: 删除 {deleted_count} 条",
                context={"days": days, "deleted_count": deleted_count}
            )

            return deleted_count
        except Exception as e:
            logger.error(f"清理旧日志失败: {str(e)}", exc_info=True)
            raise BusinessException("清理旧日志失败")

    def export_logs(
        self,
        db: Session,
        query: LogQuery,
        format: str = "json"
    ) -> str:
        """导出日志"""
        try:
            items, _ = self.get_log_list(db, query)

            if format == "json":
                return json.dumps([item.model_dump() for item in items], ensure_ascii=False, indent=2)
            elif format == "csv":
                buffer = io.StringIO()
                writer = csv.writer(buffer)
                writer.writerow([
                    "id",
                    "user_id",
                    "operator_id",
                    "tenant_id",
                    "trace_id",
                    "username",
                    "action",
                    "resource",
                    "resource_id",
                    "status",
                    "severity",
                    "error_message",
                    "ip_address",
                    "user_agent",
                    "details",
                    "created_at",
                ])
                for item in items:
                    writer.writerow([
                        item.id,
                        item.user_id or "",
                        item.operator_id or "",
                        item.tenant_id or "",
                        item.trace_id or "",
                        item.username or "",
                        item.action,
                        item.resource or "",
                        item.resource_id or "",
                        item.status,
                        item.severity,
                        item.error_message or "",
                        item.ip_address or "",
                        item.user_agent or "",
                        item.details or "",
                        item.created_at.isoformat(),
                    ])
                return "\ufeff" + buffer.getvalue()
            else:
                raise BusinessException(f"不支持的导出格式: {format}")
        except Exception as e:
            logger.error(f"导出日志失败: {str(e)}", exc_info=True)
            raise BusinessException("导出日志失败")


# 创建全局实例
log_service = LogService()
