"""Adaptive chunk selection for LLM graph extraction."""
from __future__ import annotations

import math
import re
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, Iterable, List

from services.knowledge_discovery.chunking import StructuredChunk


PLANNER_VERSION = "extraction-planner-v1"


@dataclass
class ExtractionPlanItem:
    index: int
    use_llm: bool
    priority: float
    reasons: List[str] = field(default_factory=list)
    strategy: str = "rule_only"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ExtractionPlan:
    planner_version: str
    document_type: str
    domain: str
    reasoning_profile: str
    complex_extraction: bool
    llm_budget: int
    selected_count: int
    items: List[ExtractionPlanItem]

    def item_for(self, index: int) -> ExtractionPlanItem:
        for item in self.items:
            if item.index == index:
                return item
        return ExtractionPlanItem(index=index, use_llm=False, priority=0.0, reasons=["missing_plan"])

    def to_dict(self) -> Dict[str, Any]:
        result = asdict(self)
        result["items"] = [item.to_dict() for item in self.items]
        return result


class ExtractionPlanner:
    """Choose chunks for expensive LLM extraction by structure and information value."""

    def plan(
        self,
        chunks: Iterable[StructuredChunk],
        *,
        document_profile: Dict[str, Any] | None = None,
        reasoning_profile: str | None = None,
        complex_extraction: bool = False,
        base_llm_budget: int = 2,
    ) -> ExtractionPlan:
        chunk_list = list(chunks)
        profile = document_profile or {}
        document_type = str(profile.get("document_type") or "unknown")
        domain = str(profile.get("domain") or "general")
        profile_name = self._normalize_reasoning_profile(reasoning_profile, complex_extraction)
        llm_candidates: List[tuple[float, int, List[str]]] = []
        items: List[ExtractionPlanItem] = []

        for index, chunk in enumerate(chunk_list):
            priority, reasons = self._score_chunk(chunk, document_type=document_type, profile=profile)
            if chunk.block_type == "table":
                items.append(
                    ExtractionPlanItem(
                        index=index,
                        use_llm=False,
                        priority=priority,
                        reasons=[*reasons, "structured_table_rule_extraction"],
                        strategy="structured_table",
                    )
                )
                continue
            llm_candidates.append((priority, index, reasons))

        budget = self._llm_budget(
            candidate_count=len(llm_candidates),
            reasoning_profile=profile_name,
            complex_extraction=complex_extraction,
            base_llm_budget=base_llm_budget,
        )
        selected = {
            index
            for _priority, index, _reasons in sorted(
                llm_candidates,
                key=lambda item: (-item[0], item[1]),
            )[:budget]
        }

        existing_indexes = {item.index for item in items}
        for priority, index, reasons in llm_candidates:
            if index in existing_indexes:
                continue
            use_llm = index in selected
            items.append(
                ExtractionPlanItem(
                    index=index,
                    use_llm=use_llm,
                    priority=priority,
                    reasons=reasons or ["low_signal"],
                    strategy="llm_schema_aware" if use_llm else "rule_only",
                )
            )
        items.sort(key=lambda item: item.index)
        return ExtractionPlan(
            planner_version=PLANNER_VERSION,
            document_type=document_type,
            domain=domain,
            reasoning_profile=profile_name,
            complex_extraction=complex_extraction,
            llm_budget=budget,
            selected_count=sum(1 for item in items if item.use_llm),
            items=items,
        )

    @staticmethod
    def _normalize_reasoning_profile(reasoning_profile: str | None, complex_extraction: bool) -> str:
        value = str(reasoning_profile or "").strip().lower()
        if value in {"fast", "balanced", "deep"}:
            return value
        return "balanced" if complex_extraction else "fast"

    def _llm_budget(
        self,
        *,
        candidate_count: int,
        reasoning_profile: str,
        complex_extraction: bool,
        base_llm_budget: int,
    ) -> int:
        if candidate_count <= 0:
            return 0
        base = max(0, int(base_llm_budget or 0))
        if base <= 0:
            return 0

        if reasoning_profile == "deep":
            ratio = 1.0 if candidate_count <= 20 else 0.75
            floor = min(candidate_count, 8)
            ceiling = candidate_count if candidate_count <= 20 else min(candidate_count, 64)
        elif reasoning_profile == "balanced" or complex_extraction:
            ratio = 0.45
            floor = min(candidate_count, 4)
            ceiling = min(candidate_count, 24)
        else:
            ratio = 0.22
            floor = min(candidate_count, 2)
            ceiling = min(candidate_count, 8)

        dynamic = max(base, floor, math.ceil(candidate_count * ratio))
        return max(0, min(candidate_count, ceiling, dynamic))

    def _score_chunk(
        self,
        chunk: StructuredChunk,
        *,
        document_type: str,
        profile: Dict[str, Any],
    ) -> tuple[float, List[str]]:
        text = re.sub(r"\s+", " ", chunk.text or "").strip()
        compact = re.sub(r"\s+", "", text)
        heading = " ".join(chunk.heading_path or [])
        heading_compact = re.sub(r"\s+", "", heading)
        reasons: List[str] = []
        score = 0.0

        if chunk.block_type == "table":
            score += 9.0
            reasons.append("table")
        elif chunk.block_type == "abstract":
            score += 7.0
            reasons.append("abstract")
        elif chunk.block_type == "section":
            score += 2.0
            reasons.append("section")
        else:
            score += 1.0

        for section in profile.get("important_sections") or []:
            section_text = re.sub(r"\s+", "", str(section or ""))
            if section_text and (section_text in heading_compact or heading_compact in section_text):
                score += 5.0
                reasons.append("important_section")
                break

        score += self._keyword_score(heading_compact + compact[:800], document_type, reasons)

        numeric_hits = len(re.findall(r"\d+(?:\.\d+)?\s*(?:%|kg|g|mg|m|cm|元|万元|亿元|倍|d|天|月|年)?", text))
        if numeric_hits:
            score += min(4.0, numeric_hits * 0.45)
            reasons.append("numeric_density")

        if len(compact) >= 350:
            score += 1.0
            reasons.append("substantial_text")
        if len(compact) >= 900:
            score += 0.8
            reasons.append("long_context")

        topic_hits = 0
        for topic in profile.get("main_topics") or []:
            topic_text = re.sub(r"\s+", "", str(topic or ""))
            if topic_text and topic_text in compact:
                topic_hits += 1
        if topic_hits:
            score += min(3.0, topic_hits * 0.8)
            reasons.append("topic_overlap")

        return round(score, 3), reasons

    @staticmethod
    def _keyword_score(text: str, document_type: str, reasons: List[str]) -> float:
        keywords = {
            "academic_paper": {
                "摘要": 5.0,
                "材料与方法": 4.5,
                "试验": 3.0,
                "实验": 3.0,
                "结果与分析": 4.5,
                "结果": 3.2,
                "小结": 5.0,
                "结论": 5.0,
                "讨论": 2.5,
                "指标": 2.0,
                "防效": 2.5,
                "病情指数": 2.5,
                "产量": 2.0,
                "药剂": 2.0,
            },
            "contract": {
                "甲方": 3.0,
                "乙方": 3.0,
                "标的": 4.0,
                "金额": 4.0,
                "付款": 4.5,
                "交付": 4.5,
                "违约": 5.0,
                "争议解决": 4.0,
                "解除": 4.0,
            },
            "financial_report": {
                "营业收入": 5.0,
                "净利润": 5.0,
                "现金流": 4.5,
                "同比": 3.5,
                "环比": 3.5,
                "资产": 3.0,
                "负债": 3.0,
                "风险": 4.0,
            },
            "policy": {
                "适用": 4.0,
                "要求": 4.0,
                "禁止": 4.0,
                "支持": 3.0,
                "处罚": 5.0,
                "实施": 4.0,
                "责任": 4.0,
            },
            "product_manual": {
                "参数": 5.0,
                "安装": 4.0,
                "配置": 4.0,
                "步骤": 4.0,
                "故障": 5.0,
                "告警": 5.0,
                "维护": 3.5,
                "注意": 3.0,
            },
            "meeting_minutes": {
                "议题": 4.0,
                "决议": 5.0,
                "行动项": 5.0,
                "负责人": 4.5,
                "截止": 4.0,
                "风险": 4.0,
            },
            "unknown": {
                "结论": 4.0,
                "要求": 3.0,
                "指标": 3.0,
                "风险": 3.0,
                "原因": 3.0,
                "结果": 3.0,
            },
        }
        score = 0.0
        matched = False
        merged = {**keywords["unknown"], **keywords.get(document_type, {})}
        for keyword, weight in merged.items():
            if keyword in text:
                score += weight
                matched = True
        if matched:
            reasons.append("type_keywords")
        return min(score, 10.0)


extraction_planner = ExtractionPlanner()
