#!/usr/bin/env python3
"""Unit-style check for DocQA reasoning profile propagation."""
from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))


def main() -> int:
    from api.routes.doc_qa import DeepResearchRequest, DocQARequest, handle_deep_research, handle_doc_qa
    from services.doc_qa_service import DocQAService

    request = SimpleNamespace(state=SimpleNamespace(trace_id="trace-reasoning-profile"))
    db = object()

    with patch("api.routes.doc_qa.doc_qa_service.answer", return_value={
        "answer": "ok",
        "citations": [],
        "trace": {"generation": {"model": "qwen-flash"}},
    }), patch("services.qa_trace_runtime.qa_trace_service.create_trace") as create_trace:
        body = handle_doc_qa(
            payload=DocQARequest(question="hello", top_k=2, require_citation=True, reasoning_profile="fast"),
            request=request,
            db=db,
            operator_id=1,
        )
        assert body["code"] == 200, body
        payload = create_trace.call_args.args[1]
        generation = payload.generation_snapshot
        assert generation["reasoning_profile"] == "fast", generation

    with patch("api.routes.doc_qa.doc_qa_service.answer", return_value={
        "answer": "ok",
        "citations": [],
        "trace": {"generation": {"model": "qwen-flash"}},
    }), patch("services.qa_trace_runtime.qa_trace_service.create_trace") as create_trace:
        body = handle_doc_qa(
            payload=DocQARequest(question="hello", top_k=2, require_citation=True),
            request=request,
            db=db,
            operator_id=1,
        )
        assert body["code"] == 200, body
        payload = create_trace.call_args.args[1]
        generation = payload.generation_snapshot
        assert generation["reasoning_profile"] == "balanced", generation

    with patch("api.routes.doc_qa.doc_qa_service.deep_research", return_value={
        "question": "hello",
        "summary": "ok",
        "final_conclusion": "ok",
        "report": "ok",
        "sub_questions": [],
        "citations": [],
        "confidence": {},
        "evidence_stats": {},
        "trace": {"generation": {"model": "qwen-flash"}},
    }), patch("services.qa_trace_runtime.qa_trace_service.create_trace") as create_trace:
        body = handle_deep_research(
            payload=DeepResearchRequest(question="hello", top_k=8, max_sub_questions=4, reasoning_profile="deep"),
            request=request,
            db=db,
            operator_id=1,
        )
        assert body["code"] == 200, body
        payload = create_trace.call_args.args[1]
        generation = payload.generation_snapshot
        assert generation["reasoning_profile"] == "deep", generation

    with patch("api.routes.doc_qa.doc_qa_service.deep_research", return_value={
        "question": "hello",
        "summary": "ok",
        "final_conclusion": "ok",
        "report": "ok",
        "sub_questions": [],
        "citations": [],
        "confidence": {},
        "evidence_stats": {},
        "trace": {"generation": {"model": "qwen-flash"}},
    }), patch("services.qa_trace_runtime.qa_trace_service.create_trace") as create_trace:
        body = handle_deep_research(
            payload=DeepResearchRequest(question="hello", top_k=8, max_sub_questions=4),
            request=request,
            db=db,
            operator_id=1,
        )
        assert body["code"] == 200, body
        payload = create_trace.call_args.args[1]
        generation = payload.generation_snapshot
        assert generation["reasoning_profile"] == "deep", generation

    service = DocQAService()
    service._client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(
                create=lambda **kwargs: SimpleNamespace(
                    choices=[SimpleNamespace(message=SimpleNamespace(content='{"answer":"ok","used_chunk_ids":[]}'))],
                    usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1, total_tokens=2),
                )
            )
        )
    )
    captured: list[dict] = []

    def _capture_create(**kwargs):
        captured.append(kwargs)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content='{"answer":"ok","used_chunk_ids":[]}'))],
            usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1, total_tokens=2),
        )

    service._client.chat.completions.create = _capture_create
    parsed = service._request_llm_json(
        [{"role": "user", "content": "hello"}],
        max_tokens=128,
        reasoning_profile="deep",
    )
    assert parsed["answer"] == "ok", parsed
    assert captured, "expected llm request to be captured"
    assert captured[0]["extra_body"]["reasoning"]["effort"] == "high", captured[0]

    print("DOCQA_REASONING_PROFILE_UNIT_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
