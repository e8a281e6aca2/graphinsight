"""OpenAI-compatible embedding helper for document retrieval."""
from __future__ import annotations

import hashlib
from typing import Any, Dict, Iterable, List, Optional

from core import get_logger
from services.openai_client_factory import build_openai_client
from services.runtime_config import get_embedding_runtime_config


logger = get_logger()


class EmbeddingService:
    def __init__(self) -> None:
        self._client = None
        self._client_key: Optional[tuple[str, str, str]] = None
        self._actual_dimensions: Dict[str, int] = {}
        self._dimension_warnings: set[tuple[str, int, int]] = set()

    def config(self) -> Dict[str, Any]:
        cfg = get_embedding_runtime_config()
        cfg["dimension"] = max(1, int(cfg.get("dimension") or 1536))
        model = str(cfg.get("model") or "").strip()
        if model and model in self._actual_dimensions:
            cfg["dimension"] = self._actual_dimensions[model]
        # Some OpenAI-compatible gateways cap embedding input batches at 10.
        cfg["batch_size"] = max(1, min(10, int(cfg.get("batch_size") or 10)))
        return cfg

    def is_enabled(self) -> bool:
        cfg = self.config()
        return bool(cfg.get("enabled")) and bool(str(cfg.get("api_key") or "").strip())

    def content_hash(self, text: str) -> str:
        cfg = self.config()
        raw = f"{cfg.get('model')}:{text or ''}"
        return hashlib.sha1(raw.encode("utf-8", errors="ignore")).hexdigest()

    def embed_query(self, text: str) -> Optional[List[float]]:
        vectors = self.embed_texts([text])
        return vectors[0] if vectors else None

    def embed_texts(self, texts: Iterable[str]) -> List[List[float]]:
        cfg = self.config()
        if not bool(cfg.get("enabled")):
            return []
        api_key = str(cfg.get("api_key") or "").strip()
        model = str(cfg.get("model") or "").strip()
        if not api_key or not model:
            return []

        clean_texts = [str(item or "").strip() for item in texts if str(item or "").strip()]
        if not clean_texts:
            return []

        client = self._get_client(
            api_key=api_key,
            base_url=str(cfg.get("base_url") or "").strip() or None,
            model=model,
        )
        response = client.embeddings.create(model=model, input=clean_texts, encoding_format="float")
        vectors = [list(item.embedding) for item in response.data]
        expected_dim = int(cfg.get("dimension") or 0)
        actual_dim = len(vectors[0]) if vectors else 0
        if model and actual_dim:
            self._actual_dimensions[model] = actual_dim
        warning_key = (model, expected_dim, actual_dim)
        if expected_dim and actual_dim and actual_dim != expected_dim and warning_key not in self._dimension_warnings:
            self._dimension_warnings.add(warning_key)
            logger.warning(
                "Embedding 维度与配置不一致，已按实际维度继续",
                context={
                    "configured_dimension": expected_dim,
                    "actual_dimension": actual_dim,
                    "model": model,
                },
            )
        return vectors

    def _get_client(self, *, api_key: str, base_url: Optional[str], model: str):
        key = (api_key, base_url or "", model)
        if self._client is not None and self._client_key == key:
            return self._client
        self._client = build_openai_client(api_key=api_key, base_url=base_url, timeout=45.0)
        self._client_key = key
        return self._client


embedding_service = EmbeddingService()


__all__ = ["EmbeddingService", "embedding_service"]
