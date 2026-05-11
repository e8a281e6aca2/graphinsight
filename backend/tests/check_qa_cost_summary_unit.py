#!/usr/bin/env python3
"""Unit-style check for QA cost summary aggregation."""
from __future__ import annotations

import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))


class _Query:
    def __init__(self, rows):
        self.rows = rows

    def filter(self, *_args):
        return self

    def all(self):
        return self.rows


class _Session:
    def __init__(self, rows):
        self.rows = rows

    def query(self, _model):
        return _Query(self.rows)


def _row(*, model: str, qa_type: str, status: str, prompt: int, completion: int, latency: int):
    return SimpleNamespace(
        model=model,
        qa_type=qa_type,
        status=status,
        latency_ms=latency,
        created_at=datetime.now(UTC),
        generation_snapshot=json.dumps(
            {
                "usage": {
                    "prompt_tokens": prompt,
                    "completion_tokens": completion,
                    "total_tokens": prompt + completion,
                }
            },
            ensure_ascii=False,
        ),
    )


def main() -> int:
    from admin.schemas.qa_traces import QACostSummaryQuery
    from admin.services.qa_trace_service import QATraceService

    rows = [
        _row(model="qwen-flash", qa_type="docqa", status="success", prompt=1000, completion=500, latency=1200),
        _row(model="qwen-flash", qa_type="docqa", status="failed", prompt=200, completion=0, latency=300),
        _row(model="deep-model", qa_type="deep_research", status="success", prompt=3000, completion=2000, latency=5000),
    ]
    pricing = {
        "currency": "USD",
        "models": {
            "qwen-flash": {"prompt_per_1k": 0.001, "completion_per_1k": 0.002},
            "deep-model": {"prompt_per_1k": 0.01, "completion_per_1k": 0.03},
        },
    }
    os.environ["AI_COST_MODEL_PRICING_JSON"] = json.dumps(pricing)
    try:
        with patch("admin.services.qa_trace_service.config_service.get_config", return_value=None):
            summary = QATraceService().get_cost_summary(
                _Session(rows),
                QACostSummaryQuery(window_hours=24),
            )
    finally:
        os.environ.pop("AI_COST_MODEL_PRICING_JSON", None)

    assert summary.total_calls == 3, summary
    assert summary.success_calls == 2, summary
    assert summary.failed_calls == 1, summary
    assert summary.prompt_tokens == 4200, summary
    assert summary.completion_tokens == 2500, summary
    assert summary.total_tokens == 6700, summary
    assert abs(summary.estimated_cost - 0.0922) < 0.000001, summary
    assert summary.models[0].model == "deep-model", summary.models
    assert summary.models[0].estimated_cost == 0.09, summary.models[0]
    print("QA_COST_SUMMARY_UNIT_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
