"""
任务中心服务
"""
from __future__ import annotations

import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from pathlib import Path
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from config import get_settings
from services.document_graph_service import DocumentGraphService, SUPPORTED_EXTS
from services.neo4j_service import get_neo4j_service
from ..crud import log_crud
from ..database import SessionLocal
from ..models import AdminJob, AdminLog
from ..schemas.jobs import JobCreateRequest, JobItem, JobQuery
from ..schemas.logs import LogCreate
from core import BusinessException, NotFoundException, ValidationException, get_logger

logger = get_logger()
settings = get_settings()

JOB_STATUS_PENDING = "pending"
JOB_STATUS_RUNNING = "running"
JOB_STATUS_SUCCEEDED = "succeeded"
JOB_STATUS_FAILED = "failed"
JOB_STATUS_CANCELLED = "cancelled"

ALLOWED_RETRY_FROM = {JOB_STATUS_FAILED, JOB_STATUS_CANCELLED}
ALLOWED_CANCEL_FROM = {JOB_STATUS_PENDING, JOB_STATUS_RUNNING}
SUPPORTED_JOB_TYPES = {"build_graph", "clear_kb", "reindex"}
RUNNABLE_JOB_TYPES = {"build_graph", "clear_kb", "reindex"}


def _env_int(name: str, default: int, minimum: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except Exception:
        return default
    return max(value, minimum)


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


JOB_EXECUTION_TIMEOUT_SECONDS = _env_int("JOB_EXECUTION_TIMEOUT_SECONDS", 600, 30)
JOB_HEARTBEAT_INTERVAL_SECONDS = _env_int("JOB_HEARTBEAT_INTERVAL_SECONDS", 10, 3)
JOB_AUTO_RETRY_ENABLED = _env_bool("JOB_AUTO_RETRY_ENABLED", True)
JOB_AUTO_RETRY_BASE_DELAY_SECONDS = _env_int("JOB_AUTO_RETRY_BASE_DELAY_SECONDS", 10, 1)
JOB_AUTO_RETRY_MAX_DELAY_SECONDS = _env_int("JOB_AUTO_RETRY_MAX_DELAY_SECONDS", 300, 5)


class JobExecutionTimeoutError(TimeoutError):
    """任务执行超时"""


def _to_json_text(payload: Optional[dict]) -> str:
    if payload is None:
        return "{}"
    return json.dumps(payload, ensure_ascii=False)


def _parse_json_text(value: Optional[str]) -> Optional[dict]:
    if not value:
        return None
    try:
        loaded = json.loads(value)
        return loaded if isinstance(loaded, dict) else {"raw": loaded}
    except Exception:
        return {"raw": value}


def _to_item(job: AdminJob) -> JobItem:
    return JobItem(
        id=job.id,
        job_type=job.job_type,
        status=job.status,
        tenant_id=job.tenant_id,
        project_id=job.project_id,
        kb_id=job.kb_id,
        payload=_parse_json_text(job.payload) or {},
        result=_parse_json_text(job.result),
        error_message=job.error_message,
        retry_count=job.retry_count or 0,
        max_retries=job.max_retries or 0,
        requested_by=job.requested_by,
        trace_id=job.trace_id,
        started_at=job.started_at,
        finished_at=job.finished_at,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


def _resolve_doc_dirs() -> List[Path]:
    primary = Path(settings.document_storage_path).resolve()
    primary.mkdir(parents=True, exist_ok=True)
    fallback = (Path(__file__).resolve().parents[2] / "documents").resolve()
    if fallback != primary and fallback.exists():
        return [primary, fallback]
    return [primary]


def _to_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return default


def _safe_index_name(name: str) -> str:
    normalized = "".join(ch for ch in str(name or "").strip() if ch.isalnum() or ch == "_")
    if not normalized:
        return "chunkText"
    return normalized[:64]


class JobService:
    def create_job(
        self,
        db: Session,
        *,
        job_type: str,
        request: JobCreateRequest,
        requested_by: Optional[int],
        trace_id: Optional[str] = None,
    ) -> JobItem:
        try:
            if job_type not in SUPPORTED_JOB_TYPES:
                raise ValidationException(f"不支持的任务类型: {job_type}")
            job = AdminJob(
                job_type=job_type,
                status=JOB_STATUS_PENDING,
                tenant_id=request.tenant_id,
                project_id=request.project_id,
                kb_id=request.kb_id,
                payload=_to_json_text(request.payload),
                retry_count=0,
                max_retries=request.max_retries,
                requested_by=requested_by,
                trace_id=trace_id,
            )
            db.add(job)
            db.commit()
            db.refresh(job)
            self._write_job_log(
                db,
                job=job,
                action="job_created",
                details={
                    "job_type": job.job_type,
                    "status": job.status,
                    "max_retries": job.max_retries,
                },
            )
            return _to_item(job)
        except ValidationException:
            raise
        except Exception as exc:
            db.rollback()
            logger.error(f"创建任务失败: {exc}", exc_info=True)
            raise BusinessException("创建任务失败")

    def should_auto_run(self, item: JobItem) -> bool:
        return item.job_type in RUNNABLE_JOB_TYPES and item.status == JOB_STATUS_PENDING

    def submit_job(self, background_tasks: BackgroundTasks, job_id: int) -> None:
        background_tasks.add_task(self.run_job, job_id)

    def _write_job_log(
        self,
        db: Session,
        *,
        job: AdminJob,
        action: str,
        status_value: str = "success",
        details: Optional[Dict[str, Any]] = None,
        error_message: Optional[str] = None,
    ) -> None:
        try:
            log_crud.create(
                db,
                LogCreate(
                    user_id=job.requested_by,
                    operator_id=job.requested_by,
                    tenant_id=job.tenant_id,
                    trace_id=job.trace_id,
                    action=action,
                    resource="job",
                    resource_id=str(job.id),
                    details=details or {},
                    status=status_value,
                    error_message=error_message,
                ),
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "写入任务审计日志失败",
                context={"job_id": job.id, "action": action, "error": str(exc)},
            )

    def _compute_backoff_delay(self, retry_attempt: int) -> int:
        raw = JOB_AUTO_RETRY_BASE_DELAY_SECONDS * (2 ** max(retry_attempt - 1, 0))
        return min(raw, JOB_AUTO_RETRY_MAX_DELAY_SECONDS)

    def _schedule_retry(self, job_id: int, delay_seconds: int) -> None:
        def _runner() -> None:
            if delay_seconds > 0:
                time.sleep(delay_seconds)

            db = SessionLocal()
            try:
                row = db.query(AdminJob).filter(AdminJob.id == job_id).first()
                if not row:
                    return
                if row.status != JOB_STATUS_PENDING:
                    logger.info(
                        "自动重试触发时任务状态已变化，跳过",
                        context={"job_id": job_id, "status": row.status},
                    )
                    return
            finally:
                db.close()

            self.run_job(job_id)

        thread = threading.Thread(target=_runner, daemon=True, name=f"admin-job-retry-{job_id}")
        thread.start()

    def run_job(self, job_id: int) -> None:
        db = SessionLocal()
        started_monotonic: float | None = None
        try:
            job = db.query(AdminJob).filter(AdminJob.id == job_id).first()
            if not job:
                logger.warning("任务不存在，忽略执行", context={"job_id": job_id})
                return
            if job.status != JOB_STATUS_PENDING:
                logger.info("任务状态非待执行，忽略调度", context={"job_id": job_id, "status": job.status})
                return

            job.status = JOB_STATUS_RUNNING
            job.started_at = datetime.utcnow()
            job.finished_at = None
            job.error_message = None
            db.commit()
            self._write_job_log(
                db,
                job=job,
                action="job_started",
                details={"job_type": job.job_type, "status": job.status},
            )
            started_monotonic = time.monotonic()

            result = self._execute_job_logic_with_guardrails(
                job_id=job.id,
                job_type=job.job_type,
                payload_text=job.payload,
            )
            duration_seconds = round(time.monotonic() - started_monotonic, 3)
            result.setdefault("runtime", {})
            result["runtime"].update(
                {
                    "duration_seconds": duration_seconds,
                    "timeout_seconds": JOB_EXECUTION_TIMEOUT_SECONDS,
                    "heartbeat_interval_seconds": JOB_HEARTBEAT_INTERVAL_SECONDS,
                }
            )

            db.expire_all()
            latest = db.query(AdminJob).filter(AdminJob.id == job_id).first()
            if not latest:
                logger.warning("任务执行完成但记录已丢失", context={"job_id": job_id})
                return
            if latest.status == JOB_STATUS_CANCELLED:
                logger.info("任务已被取消，跳过成功状态回写", context={"job_id": job_id})
                return

            latest.status = JOB_STATUS_SUCCEEDED
            latest.result = _to_json_text(result)
            latest.error_message = None
            latest.finished_at = datetime.utcnow()
            db.commit()
            self._write_job_log(
                db,
                job=latest,
                action="job_succeeded",
                details={
                    "job_type": latest.job_type,
                    "status": latest.status,
                    "runtime": result.get("runtime"),
                },
            )
        except Exception as exc:
            db.rollback()
            duration_seconds: float | None = None
            if started_monotonic is not None:
                duration_seconds = round(time.monotonic() - started_monotonic, 3)
            error_type = type(exc).__name__
            error_message = f"{error_type}: {str(exc)}"
            logger.error("后台任务执行失败", context={"job_id": job_id, "error": error_message}, exc_info=True)
            try:
                failed = db.query(AdminJob).filter(AdminJob.id == job_id).first()
                if failed and failed.status != JOB_STATUS_CANCELLED:
                    failed.status = JOB_STATUS_FAILED
                    failed.error_message = error_message[:2000]
                    failed.result = _to_json_text(
                        {
                            "job_id": job_id,
                            "error_type": error_type,
                            "error": str(exc),
                            "runtime": {
                                "duration_seconds": duration_seconds,
                                "timeout_seconds": JOB_EXECUTION_TIMEOUT_SECONDS,
                                "heartbeat_interval_seconds": JOB_HEARTBEAT_INTERVAL_SECONDS,
                            },
                        }
                    )
                    failed.finished_at = datetime.utcnow()
                    db.commit()
                    self._write_job_log(
                        db,
                        job=failed,
                        action="job_failed",
                        status_value="failed",
                        details={
                            "job_type": failed.job_type,
                            "status": failed.status,
                            "error_type": error_type,
                            "runtime_seconds": duration_seconds,
                        },
                        error_message=error_message[:1000],
                    )

                    if (
                        JOB_AUTO_RETRY_ENABLED
                        and failed.job_type in RUNNABLE_JOB_TYPES
                        and error_type != "ValidationException"
                        and (failed.retry_count or 0) < (failed.max_retries or 0)
                    ):
                        retry_attempt = (failed.retry_count or 0) + 1
                        delay_seconds = self._compute_backoff_delay(retry_attempt)
                        failed.retry_count = retry_attempt
                        failed.status = JOB_STATUS_PENDING
                        failed.finished_at = None
                        failed.error_message = (
                            f"{error_message[:800]} | 已计划自动重试({retry_attempt}/{failed.max_retries})，"
                            f"{delay_seconds}s 后执行"
                        )
                        db.commit()
                        self._write_job_log(
                            db,
                            job=failed,
                            action="job_retry_scheduled",
                            details={
                                "job_type": failed.job_type,
                                "retry_attempt": retry_attempt,
                                "max_retries": failed.max_retries,
                                "delay_seconds": delay_seconds,
                                "reason": error_type,
                            },
                        )
                        self._schedule_retry(job_id, delay_seconds)
            except Exception as update_exc:  # noqa: BLE001
                db.rollback()
                logger.error(
                    "回写任务失败状态异常",
                    context={"job_id": job_id, "error": str(update_exc)},
                    exc_info=True,
                )
        finally:
            db.close()

    def _heartbeat_loop(self, job_id: int, stop_event: threading.Event) -> None:
        while not stop_event.wait(JOB_HEARTBEAT_INTERVAL_SECONDS):
            hb_db = SessionLocal()
            try:
                row = hb_db.query(AdminJob).filter(AdminJob.id == job_id).first()
                if not row or row.status != JOB_STATUS_RUNNING:
                    return
                row.updated_at = datetime.utcnow()
                hb_db.commit()
            except Exception as exc:  # noqa: BLE001
                hb_db.rollback()
                logger.warning("任务心跳更新失败", context={"job_id": job_id, "error": str(exc)})
            finally:
                hb_db.close()

    def _execute_job_logic_with_guardrails(
        self,
        *,
        job_id: int,
        job_type: str,
        payload_text: Optional[str],
    ) -> Dict[str, Any]:
        payload = _parse_json_text(payload_text) or {}
        stop_event = threading.Event()
        heartbeat_thread = threading.Thread(
            target=self._heartbeat_loop,
            args=(job_id, stop_event),
            daemon=True,
            name=f"admin-job-heartbeat-{job_id}",
        )
        heartbeat_thread.start()

        executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix=f"admin-job-{job_id}")
        future = executor.submit(
            self._execute_job_logic,
            job_id=job_id,
            job_type=job_type,
            payload=payload,
        )
        try:
            return future.result(timeout=JOB_EXECUTION_TIMEOUT_SECONDS)
        except FutureTimeoutError as exc:
            future.cancel()
            raise JobExecutionTimeoutError(f"任务执行超时（>{JOB_EXECUTION_TIMEOUT_SECONDS}s）") from exc
        finally:
            stop_event.set()
            heartbeat_thread.join(timeout=1)
            executor.shutdown(wait=False, cancel_futures=True)

    def _execute_job_logic(self, *, job_id: int, job_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        if job_type == "build_graph":
            return self._execute_build_graph(job_id=job_id, payload=payload)
        if job_type == "clear_kb":
            return self._execute_clear_kb(job_id=job_id, payload=payload)
        if job_type == "reindex":
            return self._execute_reindex(job_id=job_id, payload=payload)
        raise ValidationException(f"任务类型暂不支持执行: {job_type}")

    def _execute_build_graph(self, *, job_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
        force = _to_bool(payload.get("force"), False)
        source = str(payload.get("source") or "documents")
        note = payload.get("note")
        doc_ids = [str(item).strip() for item in (payload.get("doc_ids") or []) if str(item).strip()]

        stats = DocumentGraphService().build_graph(force=force, doc_ids=doc_ids or None)
        failures = stats.get("failures", [])
        processed = stats.get("documents", 0)
        total = stats.get("total_documents", 0)
        skipped = stats.get("skipped_documents", 0)

        execution_status = "completed" if processed > 0 else "empty"
        if processed > 0:
            message = "构建完成"
        elif total > 0 and skipped == total:
            execution_status = "completed"
            message = "文档未变更，已跳过"
        elif failures:
            message = "解析失败，未产出图谱"
        else:
            message = "未发现可解析文档"

        return {
            "job_id": job_id,
            "job_type": "build_graph",
            "execution_status": execution_status,
            "message": message,
            "source": source,
            "force": force,
            "note": note,
            "doc_ids": doc_ids,
            "stats": stats,
            "failures": failures,
        }

    def _execute_clear_kb(self, *, job_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
        purge_graph = _to_bool(payload.get("purge_graph"), True)
        removed_files = 0
        removed_errors: List[str] = []
        for doc_dir in _resolve_doc_dirs():
            for file in doc_dir.rglob("*"):
                if not file.is_file():
                    continue
                if file.suffix.lower() not in SUPPORTED_EXTS:
                    continue
                try:
                    file.unlink()
                    removed_files += 1
                except Exception as exc:  # noqa: BLE001
                    removed_errors.append(f"{file.name}: {exc}")
        graph_stats = None
        if purge_graph:
            graph_stats = DocumentGraphService().clear_document_graph()

        return {
            "job_id": job_id,
            "job_type": "clear_kb",
            "execution_status": "completed",
            "message": "知识库已清空",
            "removed_files": removed_files,
            "removed_errors": removed_errors[:20],
            "purge_graph": purge_graph,
            "graph": graph_stats,
        }

    def _execute_reindex(self, *, job_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
        index_name = _safe_index_name(str(payload.get("index_name") or "chunkText"))
        neo4j_service = get_neo4j_service()
        before_state: List[Dict[str, Any]] = []
        after_state: List[Dict[str, Any]] = []

        with neo4j_service.driver.session() as session:
            try:
                before_state = [
                    dict(item)
                    for item in session.run(
                        "SHOW INDEXES YIELD name, type, state WHERE name = $name RETURN name, type, state",
                        {"name": index_name},
                    )
                ]
            except Exception:  # noqa: BLE001
                before_state = []

            session.run(f"DROP INDEX {index_name} IF EXISTS")
            session.run(
                f"CREATE FULLTEXT INDEX {index_name} IF NOT EXISTS FOR (c:Chunk) ON EACH [c.text]"
            )

            try:
                after_state = [
                    dict(item)
                    for item in session.run(
                        "SHOW INDEXES YIELD name, type, state WHERE name = $name RETURN name, type, state",
                        {"name": index_name},
                    )
                ]
            except Exception:  # noqa: BLE001
                after_state = []

        return {
            "job_id": job_id,
            "job_type": "reindex",
            "execution_status": "completed",
            "message": "索引重建完成",
            "index_name": index_name,
            "before": before_state,
            "after": after_state,
        }

    def get_job_logs(
        self,
        db: Session,
        job_id: int,
        *,
        page: int = 1,
        page_size: int = 50,
    ) -> Tuple[List[Dict[str, Any]], int]:
        try:
            exists = db.query(AdminJob.id).filter(AdminJob.id == job_id).first()
            if not exists:
                raise NotFoundException("任务不存在")

            base_query = (
                db.query(AdminLog)
                .filter(AdminLog.resource == "job", AdminLog.resource_id == str(job_id))
                .order_by(AdminLog.created_at.desc())
            )
            total = base_query.count()
            offset = (page - 1) * page_size
            rows = base_query.offset(offset).limit(page_size).all()

            items: List[Dict[str, Any]] = []
            for row in rows:
                parsed_details = _parse_json_text(row.details)
                items.append(
                    {
                        "id": row.id,
                        "action": row.action,
                        "status": row.status,
                        "error_message": row.error_message,
                        "trace_id": row.trace_id,
                        "operator_id": row.operator_id,
                        "created_at": row.created_at,
                        "details": parsed_details,
                    }
                )
            return items, total
        except NotFoundException:
            raise
        except Exception as exc:
            logger.error(f"查询任务日志失败: {exc}", exc_info=True)
            raise BusinessException("查询任务日志失败")

    def list_jobs(self, db: Session, query: JobQuery) -> Tuple[List[JobItem], int]:
        try:
            db_query = db.query(AdminJob)
            if query.job_type:
                db_query = db_query.filter(AdminJob.job_type == query.job_type)
            if query.status:
                db_query = db_query.filter(AdminJob.status == query.status)
            if query.tenant_id:
                db_query = db_query.filter(AdminJob.tenant_id == query.tenant_id)
            if query.project_id:
                db_query = db_query.filter(AdminJob.project_id == query.project_id)
            if query.kb_id:
                db_query = db_query.filter(AdminJob.kb_id == query.kb_id)

            total = db_query.count()
            offset = (query.page - 1) * query.page_size
            rows = (
                db_query.order_by(AdminJob.created_at.desc())
                .offset(offset)
                .limit(query.page_size)
                .all()
            )
            return [_to_item(row) for row in rows], total
        except Exception as exc:
            logger.error(f"查询任务列表失败: {exc}", exc_info=True)
            raise BusinessException("查询任务列表失败")

    def get_job(self, db: Session, job_id: int) -> JobItem:
        try:
            job = db.query(AdminJob).filter(AdminJob.id == job_id).first()
            if not job:
                raise NotFoundException("任务不存在")
            return _to_item(job)
        except NotFoundException:
            raise
        except Exception as exc:
            logger.error(f"查询任务详情失败: {exc}", exc_info=True)
            raise BusinessException("查询任务详情失败")

    def retry_job(self, db: Session, job_id: int, *, operator_id: Optional[int], trace_id: Optional[str]) -> JobItem:
        try:
            job = db.query(AdminJob).filter(AdminJob.id == job_id).first()
            if not job:
                raise NotFoundException("任务不存在")
            if job.status not in ALLOWED_RETRY_FROM:
                raise ValidationException("仅失败/已取消任务可重试")
            if (job.retry_count or 0) >= (job.max_retries or 0):
                raise ValidationException("任务已达到最大重试次数")

            job.retry_count = (job.retry_count or 0) + 1
            job.status = JOB_STATUS_PENDING
            job.error_message = None
            job.result = None
            job.started_at = None
            job.finished_at = None
            job.requested_by = operator_id or job.requested_by
            job.trace_id = trace_id or job.trace_id
            db.commit()
            db.refresh(job)
            self._write_job_log(
                db,
                job=job,
                action="job_retry_submitted",
                details={
                    "job_type": job.job_type,
                    "retry_count": job.retry_count,
                    "max_retries": job.max_retries,
                    "operator_id": operator_id,
                },
            )
            return _to_item(job)
        except (NotFoundException, ValidationException):
            raise
        except Exception as exc:
            db.rollback()
            logger.error(f"重试任务失败: {exc}", exc_info=True)
            raise BusinessException("重试任务失败")

    def cancel_job(self, db: Session, job_id: int, *, trace_id: Optional[str]) -> JobItem:
        try:
            job = db.query(AdminJob).filter(AdminJob.id == job_id).first()
            if not job:
                raise NotFoundException("任务不存在")
            if job.status not in ALLOWED_CANCEL_FROM:
                raise ValidationException("当前任务状态不支持取消")

            job.status = JOB_STATUS_CANCELLED
            job.finished_at = datetime.utcnow()
            job.trace_id = trace_id or job.trace_id
            db.commit()
            db.refresh(job)
            self._write_job_log(
                db,
                job=job,
                action="job_cancelled",
                details={"job_type": job.job_type, "status": job.status},
            )
            return _to_item(job)
        except (NotFoundException, ValidationException):
            raise
        except Exception as exc:
            db.rollback()
            logger.error(f"取消任务失败: {exc}", exc_info=True)
            raise BusinessException("取消任务失败")


job_service = JobService()
