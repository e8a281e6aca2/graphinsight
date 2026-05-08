"""
任务中心相关 Pydantic 模型
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, Field

JobType = Literal["build_graph", "clear_kb", "reindex"]
JobStatus = Literal["pending", "running", "succeeded", "failed", "cancelled"]


class JobCreateRequest(BaseModel):
    tenant_id: Optional[str] = Field(default=None, max_length=100)
    project_id: Optional[str] = Field(default=None, max_length=100)
    kb_id: Optional[str] = Field(default=None, max_length=100)
    payload: Dict[str, Any] = Field(default_factory=dict)
    max_retries: int = Field(default=3, ge=0, le=20)


class JobItem(BaseModel):
    id: int
    job_type: JobType
    status: JobStatus
    tenant_id: Optional[str] = None
    project_id: Optional[str] = None
    kb_id: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)
    result: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    retry_count: int = 0
    max_retries: int = 3
    requested_by: Optional[int] = None
    trace_id: Optional[str] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


class JobQuery(BaseModel):
    job_type: Optional[JobType] = None
    status: Optional[JobStatus] = None
    tenant_id: Optional[str] = None
    project_id: Optional[str] = None
    kb_id: Optional[str] = None
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=200)
