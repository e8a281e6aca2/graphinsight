"""HTTP reranker adapter for second-stage DocQA retrieval ranking."""
from __future__ import annotations

import time
from typing import Any, Dict, List

from core import get_logger
from services.openai_client_factory import build_httpx_client
from services.runtime_config import get_retrieval_runtime_config


logger = get_logger()


class RerankService:
    def rerank(self, question: str, items: List[Dict[str, Any]], top_k: int) -> Dict[str, Any]:
        started_at = time.perf_counter()
        cfg = get_retrieval_runtime_config()
        trace: Dict[str, Any] = {
            "enabled": bool(cfg.get("rerank_enabled")),
            "applied": False,
            "input_count": len(items),
        }
        if not bool(cfg.get("rerank_enabled")):
            trace["skip_reason"] = "rerank_disabled"
            return {"items": items[:top_k], "trace": trace}

        model = str(cfg.get("rerank_model") or "").strip()
        base_url = str(cfg.get("rerank_base_url") or "").strip()
        api_key = str(cfg.get("rerank_api_key") or "").strip()
        endpoint_path = self._endpoint_path(str(cfg.get("rerank_endpoint_path") or "/rerank"))
        if not model:
            trace["skip_reason"] = "rerank_model_not_configured"
            return {"items": items[:top_k], "trace": trace}
        if not base_url:
            trace["skip_reason"] = "rerank_base_url_not_configured"
            return {"items": items[:top_k], "trace": trace}
        if not api_key:
            trace["skip_reason"] = "rerank_api_key_not_configured"
            return {"items": items[:top_k], "trace": trace}
        if not question.strip() or not items:
            trace["skip_reason"] = "empty_query_or_items"
            return {"items": items[:top_k], "trace": trace}

        rerank_top_n = max(top_k, int(cfg.get("rerank_top_n") or top_k or 1))
        candidates = items[: min(len(items), rerank_top_n)]
        documents = [self._document_text(item) for item in candidates]
        try:
            url = self._join_url(base_url, endpoint_path)
            scores = self._request_scores(
                url=url,
                api_key=api_key,
                model=model,
                question=question,
                documents=documents,
                top_n=min(top_k, len(candidates)),
                timeout=float(cfg.get("rerank_timeout_seconds") or 15.0),
            )
            if not scores:
                trace.update(
                    {
                        "skip_reason": "rerank_empty_scores",
                        "model": model,
                        "endpoint_path": endpoint_path,
                        "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                    }
                )
                return {"items": items[:top_k], "trace": trace}

            reranked: List[Dict[str, Any]] = []
            for original_rank, item in enumerate(candidates):
                if original_rank not in scores:
                    continue
                updated = {**item}
                updated["prefusion_score"] = item.get("retrieval_score")
                updated["rerank_score"] = round(float(scores[original_rank]), 6)
                reranked.append(updated)
            reranked.sort(key=lambda item: float(item.get("rerank_score") or 0.0), reverse=True)
            self._normalize_retrieval_scores(reranked)

            ranked_ids = {str(item.get("id") or "") for item in reranked}
            for item in candidates:
                if str(item.get("id") or "") not in ranked_ids:
                    reranked.append(item)
            if len(items) > len(candidates):
                reranked.extend(items[len(candidates):])

            trace.update(
                {
                    "applied": True,
                    "model": model,
                    "endpoint_path": endpoint_path,
                    "reranked_count": len(scores),
                    "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                }
            )
            return {"items": reranked[:top_k], "trace": trace}
        except Exception as exc:  # noqa: BLE001
            logger.warning("Reranker 调用失败，已回退融合排序", context={"error": str(exc), "model": model})
            trace.update(
                {
                    "error": str(exc),
                    "model": model,
                    "endpoint_path": endpoint_path,
                    "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                }
            )
            return {"items": items[:top_k], "trace": trace}

    @staticmethod
    def _document_text(item: Dict[str, Any]) -> str:
        text = str(item.get("text") or item.get("snippet") or "").strip()
        if not text:
            return ""
        return text[:4000]

    @staticmethod
    def _endpoint_path(path: str) -> str:
        clean = (path or "/rerank").strip()
        if not clean:
            clean = "/rerank"
        return clean if clean.startswith("/") else f"/{clean}"

    @staticmethod
    def _join_url(base_url: str, endpoint_path: str) -> str:
        return f"{base_url.rstrip('/')}{endpoint_path}"

    def _request_scores(
        self,
        *,
        url: str,
        api_key: str,
        model: str,
        question: str,
        documents: List[str],
        top_n: int,
        timeout: float,
    ) -> Dict[int, float]:
        payload = {
            "model": model,
            "query": question,
            "documents": documents,
            "top_n": max(1, top_n),
            "return_documents": False,
        }
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        with build_httpx_client(timeout=timeout) as client:
            response = client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
        return self._parse_scores(data, expected_count=len(documents))

    @staticmethod
    def _parse_scores(data: Any, *, expected_count: int) -> Dict[int, float]:
        if isinstance(data, dict):
            for key in ("results", "data"):
                raw_items = data.get(key)
                if isinstance(raw_items, list):
                    parsed = RerankService._parse_rank_items(raw_items, expected_count=expected_count)
                    if parsed:
                        return parsed
            raw_scores = data.get("scores")
            if isinstance(raw_scores, list):
                return {
                    index: float(score)
                    for index, score in enumerate(raw_scores[:expected_count])
                    if RerankService._is_number(score)
                }
        if isinstance(data, list):
            return RerankService._parse_rank_items(data, expected_count=expected_count)
        return {}

    @staticmethod
    def _parse_rank_items(items: List[Any], *, expected_count: int) -> Dict[int, float]:
        scores: Dict[int, float] = {}
        for fallback_index, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            raw_index = item.get("index", item.get("document_index", fallback_index))
            raw_score = item.get("relevance_score", item.get("score", item.get("rerank_score")))
            try:
                index = int(raw_index)
                score = float(raw_score)
            except Exception:
                continue
            if 0 <= index < expected_count:
                scores[index] = score
        return scores

    @staticmethod
    def _normalize_retrieval_scores(items: List[Dict[str, Any]]) -> None:
        raw_scores = [float(item.get("rerank_score") or 0.0) for item in items]
        if not raw_scores:
            return
        min_score = min(raw_scores)
        max_score = max(raw_scores)
        for item in items:
            score = float(item.get("rerank_score") or 0.0)
            if max_score > min_score:
                normalized = (score - min_score) / (max_score - min_score)
            else:
                normalized = 1.0
            item["retrieval_score"] = round(max(0.0, min(1.0, normalized)), 3)

    @staticmethod
    def _is_number(value: Any) -> bool:
        try:
            float(value)
            return True
        except Exception:
            return False


rerank_service = RerankService()


__all__ = ["RerankService", "rerank_service"]
