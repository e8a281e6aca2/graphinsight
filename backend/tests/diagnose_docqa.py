"""
文档问答链路诊断脚本

用法（在项目根目录）:
  python backend/tests/diagnose_docqa.py
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request


def call(url: str) -> dict:
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310
        return json.loads(resp.read().decode("utf-8", errors="ignore"))


def post(url: str, payload: dict) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        method="POST",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
        return json.loads(resp.read().decode("utf-8", errors="ignore"))


def main() -> None:
    base = "http://localhost:8001/api/docqa/health"
    print("== DocQA Health (probe_llm=false) ==")
    basic = call(base)
    print(json.dumps(basic, ensure_ascii=False, indent=2))

    print("\n== DocQA Health (probe_llm=true) ==")
    probe_url = base + "?" + urllib.parse.urlencode({"probe_llm": "true"})
    probe = call(probe_url)
    print(json.dumps(probe, ensure_ascii=False, indent=2))

    print("\n== DocQA Deep Research ==")
    deep = post(
        "http://localhost:8001/api/docqa/deep-research",
        {
            "question": "请总结当前知识库文档的核心主题，并给出风险与下一步建议",
            "top_k": 8,
            "max_sub_questions": 4,
        },
    )
    print(json.dumps(deep, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
