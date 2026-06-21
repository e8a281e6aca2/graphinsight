"""LLM 实体抽取（OpenAI 兼容接口）"""
from __future__ import annotations

import json
import re
import time
from typing import Any, Dict, List, Optional

from config import get_settings
from core import get_logger
from services.model_runtime_policy import apply_reasoning_profile, reasoning_max_tokens
from services.knowledge_discovery.normalization import normalize_entity_values
from services.openai_client_factory import build_openai_client
from services.runtime_config import get_ai_runtime_config

logger = get_logger()
settings = get_settings()


class LLMEntityExtractor:
    def __init__(self) -> None:
        self.enabled = settings.llm_enabled and bool(settings.llm_api_key)
        self.max_entities = settings.llm_max_entities
        self.model = settings.llm_model
        self._resolved_model = self.model
        self.temperature = settings.llm_temperature
        self._client = None
        self._cache: dict[str, List[str]] = {}
        self._model_checked = False
        self._disabled_until = 0.0
        self._runtime_signature: tuple[object, ...] | None = None

        if self.enabled:
            self._client = build_openai_client(
                api_key=settings.llm_api_key,
                base_url=settings.llm_base_url or None,
                timeout=settings.llm_graph_extract_timeout_seconds,
            )

    def extract(self, text: str, reasoning_profile: Optional[str] = None) -> List[str]:
        self._refresh_runtime_config()
        if not self.enabled or not self._client:
            return []
        if self._disabled_until > time.time():
            return []

        key = text[:800]
        if key in self._cache:
            return self._cache[key]
        self._ensure_model()

        prompt = (
            "你是中文信息抽取助手。请从文本中抽取重要实体（人名、机构、地点、时间、项目、政策、" \
            "设备、资金等），返回 JSON 数组，最多 12 个，避免重复，不要解释。"
        )

        try:
            model_profile = self._bounded_graph_reasoning_profile(reasoning_profile)
            payload: Dict[str, Any] = {
                "model": self._resolved_model,
                "messages": [
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": text[:1500]},
                ],
                "temperature": self.temperature,
                "max_tokens": reasoning_max_tokens(model_profile, fast=180, balanced=220, deep=260),
            }
            response = self._client.chat.completions.create(**apply_reasoning_profile(payload, model_profile))
            content = response.choices[0].message.content or ""
            entities = self._parse_entities(content)
            if entities:
                self._cache[key] = entities
            return entities
        except Exception as exc:  # noqa: BLE001
            error_text = str(exc)
            lower_error = error_text.lower()
            provider_level_error = any(
                marker in lower_error
                for marker in (
                    "no channel available for provider",
                    "invalid api key",
                    "unauthorized",
                    "model_not_found",
                    "model not found",
                )
            )
            if "no channel available for provider" in lower_error:
                self._model_checked = False
                self._ensure_model(force=True)
            if provider_level_error:
                self._disabled_until = time.time() + 120
            logger.warning(
                "LLM 实体抽取失败，回退规则",
                context={
                    "error": error_text,
                    "model": self._resolved_model,
                    "reasoning_profile": reasoning_profile or "",
                    "model_reasoning_profile": self._bounded_graph_reasoning_profile(reasoning_profile),
                    "text_chars": min(len(text), 1500),
                },
            )
            return []

    def _refresh_runtime_config(self) -> None:
        config = get_ai_runtime_config()
        enabled = bool(config.get("enabled", True))
        api_key = str(config.get("api_key") or "").strip()
        base_url = str(config.get("base_url") or "").strip()
        model = str(config.get("model") or settings.llm_model or "").strip()
        temperature = float(config.get("temperature") or settings.llm_temperature)
        signature = (enabled, bool(api_key), base_url, model, temperature)
        if signature == self._runtime_signature:
            return

        self._runtime_signature = signature
        self.enabled = enabled and bool(api_key) and bool(model) and settings.llm_enabled
        self.model = model
        self._resolved_model = model
        self.temperature = temperature
        self._model_checked = False
        self._disabled_until = 0.0
        self._cache.clear()
        if self.enabled:
            self._client = build_openai_client(
                api_key=api_key,
                base_url=base_url or None,
                timeout=settings.llm_graph_extract_timeout_seconds,
            )
        else:
            self._client = None

    def _ensure_model(self, force: bool = False) -> None:
        if not self._client:
            return
        if self._model_checked and not force:
            return
        self._model_checked = True
        try:
            ids = [m.id for m in self._client.models.list().data]
            if not ids:
                return
            if self.model in ids:
                self._resolved_model = self.model
                return
            preferred = ["gemini-2.5-flash", "deepseek-chat", "glm-4.7"]
            for candidate in preferred:
                if candidate in ids:
                    self._resolved_model = candidate
                    break
            else:
                self._resolved_model = ids[0]
            logger.warning(
                "LLM 模型不可用，已自动切换",
                context={"from": self.model, "to": self._resolved_model},
            )
        except Exception:
            # 模型列表不可用时维持原配置，避免影响主流程
            self._resolved_model = self.model

    @staticmethod
    def _bounded_graph_reasoning_profile(reasoning_profile: Optional[str]) -> str:
        return "balanced" if str(reasoning_profile or "").strip().lower() == "deep" else "fast"

    def _parse_entities(self, content: str) -> List[str]:
        content = content.strip()
        entities: List[str] = []

        try:
            parsed = json.loads(content)
            if isinstance(parsed, dict):
                parsed = parsed.get("entities") or parsed.get("data") or []
            if isinstance(parsed, list):
                entities = parsed
        except Exception:
            match = re.search(r"\[[^\]]+\]", content, re.S)
            if match:
                try:
                    entities = json.loads(match.group(0))
                except Exception:
                    entities = []
            if not entities:
                entities = re.split(r"[\n,，;；]", content)

        return normalize_entity_values(entities, max_items=self.max_entities)


llm_entity_extractor = LLMEntityExtractor()
