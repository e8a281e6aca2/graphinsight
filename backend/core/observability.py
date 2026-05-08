"""
轻量级可观测性采集（进程内）
"""
from __future__ import annotations

import threading
import time
from collections import deque
from typing import Any, Dict, List


class ApiObservability:
    def __init__(self, max_samples: int = 5000) -> None:
        self.max_samples = max_samples
        self._lock = threading.Lock()
        self._samples: deque[dict] = deque(maxlen=max_samples)

    def record_request(
        self,
        *,
        method: str,
        path: str,
        status_code: int,
        duration_ms: float,
        trace_id: str | None = None,
    ) -> None:
        sample = {
            "ts": time.time(),
            "method": method,
            "path": path,
            "status_code": int(status_code),
            "duration_ms": float(duration_ms),
            "trace_id": trace_id,
        }
        with self._lock:
            self._samples.append(sample)

    def snapshot(self, *, window_seconds: int = 900) -> Dict[str, Any]:
        now = time.time()
        start = now - max(window_seconds, 1)
        with self._lock:
            rows = [item for item in self._samples if item["ts"] >= start]

        total = len(rows)
        failed = sum(1 for item in rows if item["status_code"] >= 400)
        durations = sorted(item["duration_ms"] for item in rows)
        by_path: Dict[str, Dict[str, int]] = {}
        for item in rows:
            path = str(item["path"])
            bucket = by_path.setdefault(path, {"total": 0, "failed": 0})
            bucket["total"] += 1
            if item["status_code"] >= 400:
                bucket["failed"] += 1

        def percentile(values: List[float], p: float) -> float:
            if not values:
                return 0.0
            pos = min(max(int(round((len(values) - 1) * p)), 0), len(values) - 1)
            return round(float(values[pos]), 3)

        rps = round(total / max(window_seconds, 1), 4)
        error_rate = round((failed / total), 6) if total > 0 else 0.0
        top_paths = sorted(by_path.items(), key=lambda item: item[1]["total"], reverse=True)[:8]
        return {
            "window_seconds": window_seconds,
            "total_requests": total,
            "failed_requests": failed,
            "error_rate": error_rate,
            "requests_per_second": rps,
            "avg_response_time_ms": round(sum(durations) / len(durations), 3) if durations else 0.0,
            "p50_response_time_ms": percentile(durations, 0.5),
            "p95_response_time_ms": percentile(durations, 0.95),
            "p99_response_time_ms": percentile(durations, 0.99),
            "top_paths": [
                {
                    "path": path,
                    "total": stat["total"],
                    "failed": stat["failed"],
                    "error_rate": round(stat["failed"] / stat["total"], 6) if stat["total"] else 0.0,
                }
                for path, stat in top_paths
            ],
            "timestamp": now,
        }


_api_observability = ApiObservability()


def get_api_observability() -> ApiObservability:
    return _api_observability


class QAObservability:
    def __init__(self, max_samples: int = 5000) -> None:
        self.max_samples = max_samples
        self._lock = threading.Lock()
        self._samples: deque[dict] = deque(maxlen=max_samples)

    def record_qa(
        self,
        *,
        qa_type: str,
        success: bool,
        citation_count: int,
        duration_ms: float,
        trace_id: str | None = None,
        error: str | None = None,
    ) -> None:
        sample = {
            "ts": time.time(),
            "qa_type": qa_type,
            "success": bool(success),
            "citation_count": int(max(citation_count, 0)),
            "duration_ms": float(duration_ms),
            "trace_id": trace_id,
            "error": error,
        }
        with self._lock:
            self._samples.append(sample)

    def snapshot(self, *, window_seconds: int = 900) -> Dict[str, Any]:
        now = time.time()
        start = now - max(window_seconds, 1)
        with self._lock:
            rows = [item for item in self._samples if item["ts"] >= start]

        total = len(rows)
        failed = sum(1 for item in rows if not item["success"])
        cited = sum(1 for item in rows if int(item["citation_count"]) > 0)
        citations = [int(item["citation_count"]) for item in rows]
        durations = sorted(float(item["duration_ms"]) for item in rows)

        by_type: Dict[str, Dict[str, Any]] = {}
        for item in rows:
            qa_type = str(item["qa_type"])
            bucket = by_type.setdefault(
                qa_type,
                {"total": 0, "failed": 0, "cited": 0, "durations": [], "citations": []},
            )
            bucket["total"] += 1
            if not item["success"]:
                bucket["failed"] += 1
            if int(item["citation_count"]) > 0:
                bucket["cited"] += 1
            bucket["durations"].append(float(item["duration_ms"]))
            bucket["citations"].append(int(item["citation_count"]))

        def percentile(values: List[float], p: float) -> float:
            if not values:
                return 0.0
            ordered = sorted(values)
            pos = min(max(int(round((len(ordered) - 1) * p)), 0), len(ordered) - 1)
            return round(float(ordered[pos]), 3)

        def avg(values: List[int] | List[float]) -> float:
            return round(float(sum(values) / len(values)), 3) if values else 0.0

        return {
            "window_seconds": window_seconds,
            "total_requests": total,
            "failed_requests": failed,
            "success_rate": round((total - failed) / total, 6) if total else 0.0,
            "failure_rate": round(failed / total, 6) if total else 0.0,
            "citation_rate": round(cited / total, 6) if total else 0.0,
            "avg_citations": avg(citations),
            "avg_latency_ms": avg(durations),
            "p50_latency_ms": percentile(durations, 0.5),
            "p95_latency_ms": percentile(durations, 0.95),
            "p99_latency_ms": percentile(durations, 0.99),
            "by_type": [
                {
                    "qa_type": qa_type,
                    "total": stat["total"],
                    "failed": stat["failed"],
                    "success_rate": round((stat["total"] - stat["failed"]) / stat["total"], 6)
                    if stat["total"]
                    else 0.0,
                    "citation_rate": round(stat["cited"] / stat["total"], 6) if stat["total"] else 0.0,
                    "avg_citations": avg(stat["citations"]),
                    "p95_latency_ms": percentile(stat["durations"], 0.95),
                }
                for qa_type, stat in sorted(by_type.items())
            ],
            "timestamp": now,
        }


_qa_observability = QAObservability()


def get_qa_observability() -> QAObservability:
    return _qa_observability
