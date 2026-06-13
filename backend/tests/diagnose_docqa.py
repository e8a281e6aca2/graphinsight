"""
文档问答链路诊断脚本

用法（在项目根目录）:
  python backend/tests/diagnose_docqa.py

默认走 Go 正式入口。
只有在明确定位仍挂载的 Python DocQA capability plane 时，
才使用 GRAPHINSIGHT_DIAG_MODE=python-internal-docqa。
"""
from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request

from runtime_env import resolve_base_url


GO_INTERNAL_HEADERS = {
    "X-Go-Orchestrator": "graphinsight-go",
    "X-Trace-Id": "diagnose-docqa",
}


def _mode() -> str:
    raw = (os.getenv("GRAPHINSIGHT_DIAG_MODE") or "go").strip().lower()
    if raw == "python-internal":
        return "python-internal-docqa"
    if raw in {"go", "python-internal-docqa"}:
        return raw
    raise SystemExit(f"Unsupported GRAPHINSIGHT_DIAG_MODE: {raw}")


def _base_url() -> str:
    mode = _mode()
    if mode == "python-internal-docqa":
        return resolve_base_url("PYTHON_BASE_URL", "http://127.0.0.1:8001").rstrip("/")
    return resolve_base_url("GO_BASE_URL", resolve_base_url("ADMIN_BASE_URL", "http://127.0.0.1:8081")).rstrip("/")


def _headers() -> dict[str, str]:
    headers: dict[str, str] = {}
    if _mode() == "python-internal-docqa":
        headers.update(GO_INTERNAL_HEADERS)
    token = (os.getenv("ADMIN_TOKEN") or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def call(url: str) -> dict:
    req = urllib.request.Request(url, method="GET", headers=_headers())
    with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310
        return json.loads(resp.read().decode("utf-8", errors="ignore"))


def post(url: str, payload: dict) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        method="POST",
        data=body,
        headers={"Content-Type": "application/json", **_headers()},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
        return json.loads(resp.read().decode("utf-8", errors="ignore"))


def main() -> None:
    base_url = _base_url()
    mode = _mode()
    if mode == "python-internal-docqa":
        health_path = "/api/internal/docqa/health"
        deep_research_path = "/api/internal/docqa/deep-research"
    else:
        health_path = "/api/docqa/health"
        deep_research_path = "/api/docqa/deep-research"

    base = f"{base_url}{health_path}"
    print(f"== Mode: {mode} | Base: {base_url} ==")
    print("== DocQA Health (probe_llm=false) ==")
    basic = call(base)
    print(json.dumps(basic, ensure_ascii=False, indent=2))

    print("\n== DocQA Health (probe_llm=true) ==")
    probe_url = base + "?" + urllib.parse.urlencode({"probe_llm": "true"})
    probe = call(probe_url)
    print(json.dumps(probe, ensure_ascii=False, indent=2))

    print("\n== DocQA Deep Research ==")
    deep = post(
        f"{base_url}{deep_research_path}",
        {
            "question": "请总结当前知识库文档的核心主题，并给出风险与下一步建议",
            "top_k": 8,
            "max_sub_questions": 4,
        },
    )
    print(json.dumps(deep, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
