"""Document profile inference for schema-aware extraction."""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, Iterable, List

from services.document_parser import ParsedDocument
from services.knowledge_discovery.chunking import StructuredChunk
from services.knowledge_discovery.profiling.document_types import DOCUMENT_TYPE_SPECS


PROFILE_VERSION = "document-profiler-v1"

_TOPIC_STOPWORDS = {
    "摘要",
    "关键词",
    "正文",
    "本文",
    "研究",
    "结果",
    "分析",
    "方法",
    "讨论",
    "小结",
    "参考文献",
    "单位",
    "表格",
    "处理",
    "进行",
    "不同",
    "情况",
    "相关",
    "合同",
    "协议",
    "甲方",
    "乙方",
}


@dataclass
class DocumentProfile:
    document_type: str = "unknown"
    domain: str = "general"
    language: str = "zh"
    main_topics: List[str] = field(default_factory=list)
    important_sections: List[str] = field(default_factory=list)
    suggested_entity_types: List[str] = field(default_factory=list)
    suggested_relation_types: List[str] = field(default_factory=list)
    confidence: float = 0.0
    profile_version: str = PROFILE_VERSION
    signals: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class DocumentProfiler:
    """Infer a compact document profile without embedding domain rules in chunking."""

    def profile(
        self,
        parsed: ParsedDocument,
        *,
        structured_chunks: Iterable[StructuredChunk] | None = None,
        file_name: str = "",
    ) -> DocumentProfile:
        chunks = list(structured_chunks or [])
        text = self._profile_text(parsed, chunks, file_name)
        headings = self._headings(chunks)
        scores = self._score_document_types(text, headings)
        document_type, raw_score = max(scores.items(), key=lambda item: item[1])
        if raw_score < 2:
            document_type = "unknown"
        spec = DOCUMENT_TYPE_SPECS.get(document_type, DOCUMENT_TYPE_SPECS["unknown"])
        confidence = self._confidence(raw_score, scores)
        domain = self._infer_domain(text, document_type)

        return DocumentProfile(
            document_type=document_type,
            domain=domain,
            language=self._infer_language(text),
            main_topics=self._extract_topics(text, headings),
            important_sections=self._important_sections(headings, document_type),
            suggested_entity_types=list(spec["entity_types"]),
            suggested_relation_types=list(spec["relation_types"]),
            confidence=confidence,
            signals={
                "scores": scores,
                "matched_keywords": self._matched_keywords(text),
                "heading_count": len(headings),
                "chunk_count": len(chunks),
            },
        )

    @staticmethod
    def _profile_text(parsed: ParsedDocument, chunks: List[StructuredChunk], file_name: str) -> str:
        parts = [file_name or ""]
        for chunk in chunks[:20]:
            parts.extend(chunk.heading_path[-2:])
            parts.append(chunk.caption)
            parts.append(chunk.text[:1200])
        if not chunks:
            parts.append(parsed.text[:6000])
        return "\n".join(part for part in parts if part).lower()

    @staticmethod
    def _headings(chunks: List[StructuredChunk]) -> List[str]:
        headings: List[str] = []
        seen = set()
        for chunk in chunks:
            for heading in chunk.heading_path:
                clean = re.sub(r"\s+", " ", str(heading or "")).strip()
                key = clean.lower()
                if clean and key not in seen:
                    seen.add(key)
                    headings.append(clean)
        return headings

    def _score_document_types(self, text: str, headings: List[str]) -> Dict[str, int]:
        heading_text = "\n".join(headings).lower()
        scores: Dict[str, int] = {}
        for doc_type, spec in DOCUMENT_TYPE_SPECS.items():
            if doc_type == "unknown":
                continue
            score = 0
            for keyword in spec.get("keywords", []):
                lowered = str(keyword).lower()
                if lowered in text:
                    score += 1
                if lowered in heading_text:
                    score += 2
            scores[doc_type] = score
        scores["unknown"] = 1
        return scores

    @staticmethod
    def _confidence(raw_score: int, scores: Dict[str, int]) -> float:
        ordered = sorted(scores.values(), reverse=True)
        second = ordered[1] if len(ordered) > 1 else 0
        if raw_score < 2:
            return 0.35
        margin = max(0, raw_score - second)
        return round(min(0.95, 0.45 + raw_score * 0.06 + margin * 0.04), 3)

    @staticmethod
    def _infer_language(text: str) -> str:
        cjk = len(re.findall(r"[\u4e00-\u9fff]", text))
        latin = len(re.findall(r"[A-Za-z]", text))
        if cjk >= latin:
            return "zh"
        return "en"

    @staticmethod
    def _infer_domain(text: str, document_type: str) -> str:
        compact = re.sub(r"\s+", "", text)
        if document_type == "academic_paper":
            if any(term in compact for term in ("小麦", "药剂", "病害", "防效", "赤霉病", "条锈病", "农业")):
                return "agricultural_plant_protection"
            if any(term in compact for term in ("患者", "临床", "病例", "治疗", "医院")):
                return "medical_research"
            return "academic_research"
        if document_type == "contract":
            return "legal_contract"
        if document_type == "financial_report":
            return "finance"
        if document_type == "policy":
            return "public_policy"
        if document_type == "product_manual":
            return "product_technical"
        if document_type == "meeting_minutes":
            return "operations_meeting"
        return "general"

    @staticmethod
    def _extract_topics(text: str, headings: List[str]) -> List[str]:
        candidates: List[str] = []
        for heading in headings[:12]:
            clean = re.sub(r"^#+\s*", "", heading).strip()
            clean = re.sub(r"^(?:第?[一二三四五六七八九十\d]+[章节、.．]\s*|\d+(?:\.\d+)*\s+)", "", clean).strip()
            if 2 <= len(clean) <= 24:
                candidates.append(clean)
        for match in re.finditer(r"[\u4e00-\u9fffA-Za-z0-9/%.-]{2,24}(?:病|药剂|合同|报告|指标|政策|产品|系统|项目|公司|收入|利润)", text):
            candidates.append(match.group(0))
        freq: Dict[str, int] = {}
        for item in candidates:
            clean = re.sub(r"\s+", "", item).strip(" ，,;；。:：")
            if not clean or clean in _TOPIC_STOPWORDS or len(clean) > 32:
                continue
            if re.match(r"^(?:最高|最低|平均|各|和).{0,6}病$", clean):
                continue
            freq[clean] = freq.get(clean, 0) + 1
        ranked = sorted(freq.items(), key=lambda item: (-item[1], len(item[0])))
        topics: List[str] = []
        all_terms = set(freq)
        for item, _ in ranked:
            if any(other != item and other.endswith(item) and re.match(r"^\d", other) for other in all_terms):
                continue
            topics.append(item)
            if len(topics) >= 8:
                break
        return topics

    @staticmethod
    def _important_sections(headings: List[str], document_type: str) -> List[str]:
        preferred = {
            "academic_paper": ["摘要", "材料与方法", "结果", "结果与分析", "讨论", "小结", "结论"],
            "contract": ["合同主体", "标的", "付款", "交付", "违约责任", "争议解决"],
            "financial_report": ["管理层讨论", "财务报表", "营业收入", "风险因素", "现金流"],
            "policy": ["适用范围", "主要任务", "保障措施", "实施时间", "责任分工"],
            "product_manual": ["安装", "操作", "参数", "故障", "维护", "安全"],
            "meeting_minutes": ["参会", "议题", "决议", "行动项", "负责人"],
        }.get(document_type, [])
        result: List[str] = []
        for heading in headings:
            if any(term in heading for term in preferred):
                result.append(heading)
        if not result:
            result = headings[:8]
        return result[:10]

    @staticmethod
    def _matched_keywords(text: str) -> Dict[str, List[str]]:
        matched: Dict[str, List[str]] = {}
        for doc_type, spec in DOCUMENT_TYPE_SPECS.items():
            hits = [keyword for keyword in spec.get("keywords", []) if str(keyword).lower() in text]
            if hits:
                matched[doc_type] = hits[:12]
        return matched


document_profiler = DocumentProfiler()
