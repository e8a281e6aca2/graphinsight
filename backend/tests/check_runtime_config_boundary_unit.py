#!/usr/bin/env python3
"""Static guard for Python runtime config boundary."""
from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _source(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    nl2_source = _source("services/nl2cypher_service.py")
    neo4j_source = _source("services/neo4j_service.py")
    job_source = _source("admin/services/job_service.py")
    job_runtime_source = _source("services/job_runtime.py")
    qa_trace_source = _source("admin/services/qa_trace_service.py")
    monitor_source = _source("admin/services/monitor_service.py")
    docqa_route_source = _source("api/routes/doc_qa.py")
    docqa_internal_route_source = _source("api/routes/doc_qa_internal.py")
    helper_source = _source("services/runtime_config.py")
    db_helper_source = _source("services/runtime_db.py")

    for label, source in (
        ("nl2cypher_service", nl2_source),
        ("neo4j_service", neo4j_source),
        ("qa_trace_service", qa_trace_source),
        ("monitor_service", monitor_source),
    ):
        _assert("from admin.services.config_service import config_service" not in source, f"{label} must not import admin config_service directly")
        _assert("from .config_service import config_service" not in source, f"{label} must not import local admin config_service directly")
        _assert("from admin.database import SessionLocal" not in source, f"{label} must not own direct admin SessionLocal reads")

    _assert("from .config_service import config_service" not in job_source, "job_service build-graph defaults must not import admin config_service directly")
    _assert("from services.job_runtime import execute_job" in job_source, "job_service should delegate runnable execution to job runtime")
    _assert("DocumentGraphService" not in job_source, "job_service must not own graph execution capability directly")
    _assert("get_graph_build_runtime_defaults" not in job_source, "job_service must not own graph runtime config defaults directly")
    _assert("get_neo4j_service" not in job_source, "job_service must not own Neo4j execution directly")
    _assert("def execute_job" in job_runtime_source, "job runtime missing execute_job dispatcher")
    _assert("get_graph_build_runtime_defaults" in job_runtime_source, "job runtime should own graph build runtime defaults")

    _assert("admin.schemas.qa_traces" not in docqa_route_source, "DocQA capability route must not import admin QA trace schemas directly")
    _assert("admin.services" not in docqa_route_source, "DocQA capability route must not import admin services directly")
    _assert("record_qa_trace" in docqa_route_source, "DocQA capability route should use runtime QA trace recorder")
    _assert("admin.database" not in docqa_internal_route_source, "DocQA internal route must use runtime DB dependency adapter")
    _assert("get_runtime_db" in docqa_internal_route_source, "DocQA internal route should depend on runtime DB adapter")

    _assert(not (ROOT / "api/routes/documents.py").exists(), "retired Python documents route implementation must stay removed")

    _assert("def get_ai_runtime_config" in helper_source, "runtime_config helper missing AI runtime loader")
    _assert("def get_ai_cost_runtime_config" in helper_source, "runtime_config helper missing AI cost runtime loader")
    _assert("def get_nl2cypher_runtime_config" in helper_source, "runtime_config helper missing NL2Cypher runtime loader")
    _assert("def get_neo4j_runtime_config" in helper_source, "runtime_config helper missing Neo4j runtime loader")
    _assert("def get_runtime_db" in db_helper_source, "runtime DB helper missing get_runtime_db")
    _assert("from admin.database import SessionLocal" in db_helper_source, "runtime DB helper should be the DB dependency adapter")

    print("RUNTIME_CONFIG_BOUNDARY_UNIT_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
