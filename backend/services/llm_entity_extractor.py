"""LLM 实体抽取（OpenAI 兼容接口）"""
from __future__ import annotations

import json
import re
from typing import List, Optional

from openai import OpenAI

from config import get_settings
from core import get_logger

logger = get_logger()
settings = get_settings()


class LLMEntityExtractor:
    def __init__(self) -> None:
        self.enabled = settings.llm_enabled and bool(settings.llm_api_key)
        self.max_entities = settings.llm_max_entities
        self.model = settings.llm_model
        self.temperature = settings.llm_temperature
        self._client: Optional[OpenAI] = None
        self._cache: dict[str, List[str]] = {}

        if self.enabled:
            client_kwargs = {"api_key": settings.llm_api_key}
            if settings.llm_base_url:
                client_kwargs["base_url"] = settings.llm_base_url
            self._client = OpenAI(**client_kwargs)

    def extract(self, text: str) -> List[str]:
        if not self.enabled or not self._client:
            return []

        key = text[:800]
        if key in self._cache:
            return self._cache[key]

        prompt = (
            "你是中文信息抽取助手。请从文本中抽取重要实体（人名、机构、地点、时间、项目、政策、" \
            "设备、资金等），返回 JSON 数组，最多 12 个，避免重复，不要解释。"
        )

        try:
            response = self._client.chat.completions.create(
                model=self.model,
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
            logger.warning("LLM 抽取失败，回退规则", context={"error": str(exc)})
            return []

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
