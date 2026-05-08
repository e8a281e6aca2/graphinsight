"""LLM 关系抽取（OpenAI 兼容接口）"""
from __future__ import annotations

import json
import re
import time
from typing import Dict, List, Optional

from config import get_settings
from core import get_logger
from services.openai_client_factory import build_openai_client

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
        self._resolved_model = self.model
        self.temperature = settings.llm_relation_temperature
        self._client = None
        self._cache: Dict[str, List[Dict[str, object]]] = {}
        self._model_checked = False
        self._disabled_until = 0.0

        if self.enabled:
            self._client = build_openai_client(
                api_key=settings.llm_api_key,
                base_url=settings.llm_base_url or None,
                timeout=30.0,
            )

    def extract(self, text: str, entities: List[str]) -> List[Dict[str, object]]:
        if not self.enabled or not self._client:
            return []
        if len(entities) < 2:
            return []
        if self._disabled_until > time.time():
            return []

        key = (text[:600] + "|" + "|".join(sorted(entities)))[:1200]
        if key in self._cache:
            return self._cache[key]
        self._ensure_model()

        prompt = (
            "你是中文信息抽取助手。给定一段文本和实体列表，识别实体之间明确的关系。"
            "输出 JSON 数组，每项包含 source、target、label，可选 confidence(0-1)。"
            "source/target 必须来自实体列表，label 用简短中文关系短语（如“属于/隶属/位于/生产/导致/使用/批准”）。"
            "如果没有关系返回 []，不要解释。"
        )

        try:
            response = self._client.chat.completions.create(
                model=self._resolved_model,
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
            error_text = str(exc)
            if "no channel available for provider" in error_text.lower():
                self._model_checked = False
                self._ensure_model(force=True)
            self._disabled_until = time.time() + 120
            logger.warning(
                "LLM 关系抽取失败",
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
            self._resolved_model = self.model

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
