"""LLM 关系抽取（OpenAI 兼容接口）"""
from __future__ import annotations

import json
import re
from typing import Dict, List, Optional

from openai import OpenAI

from config import get_settings
from core import get_logger

logger = get_logger()
settings = get_settings()


class LLMRelationExtractor:
    def __init__(self) -> None:
        self.enabled = (
            settings.llm_enabled
            and settings.llm_relation_enabled
            and bool(settings.llm_api_key)
        )
        self.max_relations = settings.llm_max_relations
        self.model = settings.llm_relation_model
        self.temperature = settings.llm_relation_temperature
        self._client: Optional[OpenAI] = None
        self._cache: Dict[str, List[Dict[str, object]]] = {}

        if self.enabled:
            client_kwargs = {"api_key": settings.llm_api_key}
            if settings.llm_base_url:
                client_kwargs["base_url"] = settings.llm_base_url
            self._client = OpenAI(**client_kwargs)

    def extract(self, text: str, entities: List[str]) -> List[Dict[str, object]]:
        if not self.enabled or not self._client:
            return []
        if len(entities) < 2:
            return []

        key = (text[:600] + "|" + "|".join(sorted(entities)))[:1200]
        if key in self._cache:
            return self._cache[key]

        prompt = (
            "你是中文信息抽取助手。给定一段文本和实体列表，识别实体之间明确的关系。"
            "输出 JSON 数组，每项包含 source、target、label，可选 confidence(0-1)。"
            "source/target 必须来自实体列表，label 用简短中文关系短语（如“属于/隶属/位于/生产/导致/使用/批准”）。"
            "如果没有关系返回 []，不要解释。"
        )

        try:
            response = self._client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": prompt},
                    {
                        "role": "user",
                        "content": f"实体列表：{json.dumps(entities, ensure_ascii=False)}\n文本：{text[:1500]}",
                    },
                ],
                temperature=self.temperature,
                max_tokens=280,
            )
            content = response.choices[0].message.content or ""
            relations = self._parse_relations(content, set(entities))
            if relations:
                self._cache[key] = relations
            return relations
        except Exception as exc:  # noqa: BLE001
            logger.warning("LLM 关系抽取失败", context={"error": str(exc)})
            return []

    def _parse_relations(
        self, content: str, entity_set: set[str]
    ) -> List[Dict[str, object]]:
        content = content.strip()
        relations: List[Dict[str, object]] = []

        def _normalize_entity(raw: object) -> str:
            return str(raw).strip()

        def _append(item: Dict[str, object]) -> None:
            source = _normalize_entity(item.get("source") or item.get("from") or "")
            target = _normalize_entity(item.get("target") or item.get("to") or "")
            label = str(item.get("label") or item.get("relation") or item.get("type") or "").strip()
            if not source or not target or not label:
                return
            if source not in entity_set or target not in entity_set:
                return
            if source == target:
                return
            confidence = item.get("confidence")
            if isinstance(confidence, str):
                try:
                    confidence = float(confidence)
                except Exception:
                    confidence = None
            relation = {"source": source, "target": target, "label": label}
            if isinstance(confidence, (int, float)):
                relation["confidence"] = float(confidence)
            relations.append(relation)

        try:
            parsed = json.loads(content)
            if isinstance(parsed, dict):
                parsed = parsed.get("relations") or parsed.get("data") or []
            if isinstance(parsed, list):
                for item in parsed:
                    if isinstance(item, dict):
                        _append(item)
        except Exception:
            match = re.search(r"\[[\s\S]+\]", content)
            if match:
                try:
                    parsed = json.loads(match.group(0))
                    if isinstance(parsed, list):
                        for item in parsed:
                            if isinstance(item, dict):
                                _append(item)
                except Exception:
                    pass

        # 去重 + 截断
        seen = set()
        deduped: List[Dict[str, object]] = []
        for item in relations:
            key = (item["source"], item["target"], item["label"])
            if key in seen:
                continue
            seen.add(key)
            deduped.append(item)
            if len(deduped) >= self.max_relations:
                break
        return deduped


llm_relation_extractor = LLMRelationExtractor()

