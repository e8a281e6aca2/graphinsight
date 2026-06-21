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
    }) as answer_mock, patch("services.qa_trace_runtime.qa_trace_service.create_trace") as create_trace:
        body = handle_doc_qa(
            payload=DocQARequest(
                question="他们的工作单位呢",
                top_k=2,
                require_citation=True,
                reasoning_profile="fast",
                conversation_history=[
                    {"role": "user", "content": "郑雪梅和兰香瑚是谁？"},
                    {"role": "assistant", "content": "他们是论文作者。"},
                ],
            ),
            request=request,
            db=db,
            operator_id=1,
        )
        assert body["code"] == 200, body
        assert answer_mock.call_args.kwargs["conversation_history"][0]["role"] == "user"
        assert "郑雪梅" in answer_mock.call_args.kwargs["conversation_history"][0]["content"]
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

    runtime_service = DocQAService()
    with patch("services.doc_qa_service.get_ai_runtime_config", return_value={
        "enabled": True,
        "api_key": "sk-runtime",
        "base_url": "https://runtime.example/v1",
        "model": "qwen-runtime",
        "temperature": 0.1,
        "max_tokens": 321,
    }), patch("services.doc_qa_service.build_openai_client") as build_client:
        build_client.return_value = SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=_capture_create))
        )
        runtime_service._refresh_runtime_config()
        assert runtime_service.enabled is True
        assert runtime_service.model == "qwen-runtime"
        assert runtime_service.max_tokens == 321
        assert runtime_service._base_url_label() == "https://runtime.example/v1"
        build_client.assert_called_with(
            api_key="sk-runtime",
            base_url="https://runtime.example/v1",
            timeout=30.0,
        )

    contextual_query = service._contextual_retrieval_query(
        "他们的工作单位呢",
        [
            {"role": "user", "content": "郑雪梅和兰香瑚是谁？"},
            {"role": "assistant", "content": "郑雪梅和兰香瑚是论文作者。"},
        ],
    )
    assert "郑雪梅" in contextual_query and "兰香瑚" in contextual_query, contextual_query

    citations = [
        {
            "id": "chunk-a",
            "title": "测试文档",
            "text": (
                "郑雪梅，兰香瑚，张国升，母先富（贵州省金沙县农作物保护中心，贵州 金沙 551800）。"
                "[摘要] 为筛选出适宜防治小麦条锈病和赤霉病的新型高效化学药剂。"
            ),
            "snippet": "[摘要] 为筛选出适宜防治小麦条锈病和赤霉病的新型高效化学药剂。",
        }
    ]
    service._focus_citation_snippets(citations, "他们的工作单位呢", "他们的工作单位是贵州省金沙县农作物保护中心。")
    assert "贵州省金沙县农作物保护中心" in citations[0]["snippet"], citations[0]["snippet"]

    print("DOCQA_REASONING_PROFILE_UNIT_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
