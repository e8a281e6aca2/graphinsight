"""LLM 实体抽取（OpenAI 兼容接口）"""
from __future__ import annotations

import json
import re
import time
from typing import List, Optional

from config import get_settings
from core import get_logger
from services.openai_client_factory import build_openai_client

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

        if self.enabled:
            self._client = build_openai_client(
                api_key=settings.llm_api_key,
                base_url=settings.llm_base_url or None,
                timeout=30.0,
            )

    def extract(self, text: str) -> List[str]:
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
            response = self._client.chat.completions.create(
                model=self._resolved_model,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": text[:1500]},
                ],
                temperature=self.temperature,
                max_tokens=200,
            )
            content = response.choices[0].message.content or ""
            entities = self._parse_entities(content)
            if entities:
                self._cache[key] = entities
            return entities
        except Exception as exc:  # noqa: BLE001
            error_text = str(exc)
            if "no channel available for provider" in error_text.lower():
                self._model_checked = False
                self._ensure_model(force=True)
            self._disabled_until = time.time() + 120
            logger.warning(
                "LLM 抽取失败，回退规则",
                context={"error": error_text, "model": self._resolved_model},
            )
            return []

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

    def _parse_entities(self, content: str) -> List[str]:
        content = content.strip()
        entities: List[str] = []

        try:
            parsed = json.loads(content)
            if isinstance(parsed, dict):
                parsed = parsed.get("entities") or parsed.get("data") or []
            if isinstance(parsed, list):
                entities = [str(item) for item in parsed]
        except Exception:
            match = re.search(r"\[[^\]]+\]", content, re.S)
            if match:
                try:
                    entities = json.loads(match.group(0))
                except Exception:
                    entities = []
            if not entities:
                entities = re.split(r"[\n,，;；]", content)

        clean: List[str] = []
        seen = set()
        for item in entities:
            token = str(item).strip().strip('"').strip("'")
            if not token:
                continue
            key = token.lower()
            if key in seen:
                continue
            seen.add(key)
            clean.append(token)
            if len(clean) >= self.max_entities:
                break
        return clean


llm_entity_extractor = LLMEntityExtractor()
