"""LLM 关系抽取（OpenAI 兼容接口）"""
from __future__ import annotations

import json
import re
import time
from typing import Any, Dict, List, Optional

from config import get_settings
from core import get_logger
from services.model_runtime_policy import apply_reasoning_profile, reasoning_max_tokens
from services.knowledge_discovery.normalization import normalize_entity_name
from services.openai_client_factory import build_openai_client
from services.runtime_config import get_ai_runtime_config

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
        self.text_budget = settings.llm_relation_text_budget
        self.max_prompt_entities = settings.llm_relation_max_prompt_entities
        self._client = None
        self._cache: Dict[str, List[Dict[str, object]]] = {}
        self._model_checked = False
        self._disabled_until = 0.0
        self._timeout_failures = 0
        self._runtime_signature: tuple[object, ...] | None = None

        if self.enabled:
            self._client = build_openai_client(
                api_key=settings.llm_api_key,
                base_url=settings.llm_base_url or None,
                timeout=settings.llm_graph_extract_timeout_seconds,
            )

    def extract(
        self,
        text: str,
        entities: List[str],
        reasoning_profile: Optional[str] = None,
    ) -> List[Dict[str, object]]:
        self._refresh_runtime_config()
        if not self.enabled or not self._client:
            return []
        if len(entities) < 2:
            return []
        if self._disabled_until > time.time():
            return []

        prompt_text, prompt_entities = self._prepare_prompt_inputs(text, entities)
        if len(prompt_entities) < 2:
            return []

        key = (prompt_text[:600] + "|" + "|".join(sorted(prompt_entities)))[:1200]
        if key in self._cache:
            return self._cache[key]
        self._ensure_model()

        prompt = self._build_schema_prompt()

        try:
            model_profile = self._bounded_graph_reasoning_profile(reasoning_profile)
            payload: Dict[str, Any] = {
                "model": self._resolved_model,
                "messages": [
                    {"role": "system", "content": prompt},
                    {
                        "role": "user",
                        "content": self._build_user_prompt(text=prompt_text, entities=prompt_entities),
                    },
                ],
                "temperature": self.temperature,
                "max_tokens": reasoning_max_tokens(model_profile, fast=220, balanced=300, deep=380),
            }
            response = self._client.chat.completions.create(**apply_reasoning_profile(payload, model_profile))
            content = response.choices[0].message.content or ""
            relations = self._parse_relations(content, set(prompt_entities))
            if relations:
                self._cache[key] = relations
            return relations
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
            error_kind = self._classify_error(lower_error)
            if error_kind == "timeout":
                self._timeout_failures += 1
                if self._timeout_failures >= 2:
                    self._disabled_until = time.time() + 90
            else:
                self._timeout_failures = 0
            logger.warning(
                f"LLM 关系抽取失败: {error_kind}",
                context={
                    "error": error_text,
                    "error_kind": error_kind,
                    "model": self._resolved_model,
                    "reasoning_profile": reasoning_profile or "",
                    "model_reasoning_profile": self._bounded_graph_reasoning_profile(reasoning_profile),
                    "text_chars": len(prompt_text),
                    "entity_count": len(prompt_entities),
                    "timeout_failures": self._timeout_failures,
                    "cooldown_seconds": max(0, int(self._disabled_until - time.time())),
                },
            )
            return []

    def _refresh_runtime_config(self) -> None:
        config = get_ai_runtime_config()
        enabled = bool(config.get("enabled", True))
        api_key = str(config.get("api_key") or "").strip()
        base_url = str(config.get("base_url") or "").strip()
        model = str(config.get("model") or settings.llm_relation_model or settings.llm_model or "").strip()
        temperature = float(config.get("temperature") or settings.llm_relation_temperature)
        signature = (enabled, bool(api_key), base_url, model, temperature, settings.llm_relation_enabled)
        if signature == self._runtime_signature:
            return

        self._runtime_signature = signature
        self.enabled = enabled and settings.llm_enabled and settings.llm_relation_enabled and bool(api_key) and bool(model)
        self.model = model
        self._resolved_model = model
        self.temperature = temperature
        self.text_budget = max(400, settings.llm_relation_text_budget)
        self.max_prompt_entities = max(4, settings.llm_relation_max_prompt_entities)
        self._model_checked = False
        self._disabled_until = 0.0
        self._timeout_failures = 0
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
            self._resolved_model = self.model

    def _prepare_prompt_inputs(self, text: str, entities: List[str]) -> tuple[str, List[str]]:
        prompt_text = re.sub(r"\s+", " ", text or "").strip()[: self.text_budget]
        compact_text = self._entity_key(prompt_text)
        ranked: List[tuple[int, int, int, str]] = []
        seen = set()

        for index, entity in enumerate(entities):
            name = normalize_entity_name(entity)
            key = self._entity_key(name)
            if not name or key in seen:
                continue
            seen.add(key)
            position = compact_text.find(key)
            if position < 0:
                continue
            ranked.append((position, -len(key), index, name))

        ranked.sort()
        selected = [item[-1] for item in ranked[: self.max_prompt_entities]]
        if len(selected) >= 2:
            return prompt_text, selected

        # OCR and formula spacing can prevent exact compact matching. Keep a small
        # deterministic fallback so the extractor can still work on unusual chunks.
        fallback: List[str] = []
        seen.clear()
        for entity in entities:
            name = normalize_entity_name(entity)
            key = self._entity_key(name)
            if not name or key in seen:
                continue
            seen.add(key)
            fallback.append(name)
            if len(fallback) >= min(self.max_prompt_entities, 8):
                break
        return prompt_text, fallback

    @staticmethod
    def _classify_error(lower_error: str) -> str:
        if "timed out" in lower_error or "timeout" in lower_error:
            return "timeout"
        if "no channel available for provider" in lower_error:
            return "provider_channel_unavailable"
        if "invalid api key" in lower_error or "unauthorized" in lower_error:
            return "unauthorized"
        if "model_not_found" in lower_error or "model not found" in lower_error:
            return "model_not_found"
        if "rate limit" in lower_error or "429" in lower_error:
            return "rate_limited"
        return "unknown"

    @staticmethod
    def _bounded_graph_reasoning_profile(reasoning_profile: Optional[str]) -> str:
        return "balanced" if str(reasoning_profile or "").strip().lower() == "deep" else "fast"

    @staticmethod
    def _build_schema_prompt() -> str:
        schema = {
            "relations": [
                {"label": "防治对象", "description": "药剂、措施、方案作用于某病害或对象"},
                {"label": "平均防效", "description": "处理、药剂或方案对应的防治效果"},
                {"label": "病情指数", "description": "处理、时间或对象对应的病情指数"},
                {"label": "产量", "description": "处理、药剂或试验条件对应的产量"},
                {"label": "增产率", "description": "处理或药剂相对对照的增产率"},
                {"label": "使用剂量", "description": "处理或药剂对应的用量、浓度、稀释倍数"},
                {"label": "发生阶段", "description": "病害、事件或现象发生的时间阶段"},
                {"label": "地点", "description": "试验、事件或机构所在地点"},
                {"label": "属于", "description": "实体的类型、类别或上下位关系"},
                {"label": "影响", "description": "一个因素对另一个结果造成影响"},
            ]
        }
        return (
            "你是企业级知识图谱关系抽取器。只能抽取文本中有明确证据的关系。"
            "必须遵守以下 schema 和输出协议："
            f"\n关系类型候选：{json.dumps(schema, ensure_ascii=False)}"
            "\n输出 JSON 数组；每项必须包含 source、target、label、evidence、confidence。"
            "\nsource/target 必须来自实体列表，不要创造新实体。"
            "\nlabel 优先使用候选关系类型；没有合适类型时使用不超过 8 个汉字的短关系词。"
            "\nevidence 必须是原文中的连续短句或表格行片段，不允许生成解释性证据。"
            "\nconfidence 取 0 到 1；证据不明确、只是同段出现、或需要推断过多时不要输出。"
            "\n如果没有高质量关系，返回 []。不要输出 Markdown，不要解释。"
        )

    @staticmethod
    def _build_user_prompt(*, text: str, entities: List[str]) -> str:
        return (
            f"实体列表：{json.dumps(entities, ensure_ascii=False)}\n"
            f"文本：{text}\n"
            "请只返回 JSON 数组。"
        )

    def _parse_relations(self, content: str, entity_set: set[str]) -> List[Dict[str, object]]:
        content = content.strip()
        relations: List[Dict[str, object]] = []
        canonical_entities: Dict[str, str] = {}
        for entity in entity_set:
            normalized = normalize_entity_name(entity)
            if normalized:
                canonical_entities[self._entity_key(normalized)] = entity

        def _normalize_entity(raw: object) -> str:
            name = normalize_entity_name(raw)
            return canonical_entities.get(self._entity_key(name), name)

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
                relation["confidence"] = max(0.0, min(1.0, float(confidence)))
            evidence = str(item.get("evidence") or item.get("quote") or item.get("text") or "").strip()
            if evidence:
                relation["evidence"] = evidence[:1000]
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

    @staticmethod
    def _entity_key(value: object) -> str:
        return re.sub(r"\s+", "", str(value or "")).lower()


llm_relation_extractor = LLMRelationExtractor()
