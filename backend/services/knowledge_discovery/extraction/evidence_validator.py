"""Evidence anchoring for extracted graph relations."""
from __future__ import annotations

import re
from typing import Dict, Iterable, Optional

from services.knowledge_discovery.normalization import normalize_entity_name


class EvidenceValidator:
    """Validate and enrich relation evidence against the source chunk text."""

    def validate_relation(
        self,
        relation: Dict[str, object],
        text: str,
        *,
        require_evidence: bool = True,
    ) -> Optional[Dict[str, object]]:
        source = normalize_entity_name(relation.get("source") or "")
        target = normalize_entity_name(relation.get("target") or "")
        label = str(relation.get("label") or relation.get("relation") or relation.get("type") or "").strip()
        if not source or not target or not label or source == target:
            return None

        evidence = str(relation.get("evidence") or "").strip()
        if evidence and not self.is_supported(evidence, text):
            evidence = ""
        if not evidence:
            evidence = self.find_evidence(text, [source, target], require_all=True)
        if require_evidence and not evidence:
            return None

        enriched = dict(relation)
        enriched["source"] = source
        enriched["target"] = target
        enriched["label"] = label
        if evidence:
            enriched["evidence"] = evidence[:1000]
        return enriched

    def is_supported(self, evidence: str, text: str) -> bool:
        evidence_norm = self._compact(evidence)
        text_norm = self._compact(text)
        if not evidence_norm or not text_norm:
            return False
        if evidence_norm in text_norm:
            return True
        # Allow short evidence snippets to survive OCR/Markdown spacing differences.
        tokens = [token for token in re.split(r"[，,；;。.\s:：=]+", evidence) if len(token.strip()) >= 2]
        if not tokens:
            return False
        hits = sum(1 for token in tokens if self._compact(token) in text_norm)
        return hits >= max(1, min(3, len(tokens)))

    def find_evidence(
        self,
        text: str,
        entities: Iterable[str],
        *,
        max_len: int = 240,
        require_all: bool = False,
    ) -> str:
        cleaned = re.sub(r"\s+", " ", text or "").strip()
        if not cleaned:
            return ""

        entity_terms = [self._compact(item) for item in entities if self._compact(item)]
        if not entity_terms:
            return ""

        sentences = [item.strip() for item in re.split(r"(?<=[。！？!?；;])\s*", cleaned) if item.strip()]
        if not sentences:
            sentences = [cleaned]

        for sentence in sentences:
            compact_sentence = self._compact(sentence)
            if all(term in compact_sentence for term in entity_terms):
                return sentence[:max_len]

        if not require_all:
            for sentence in sentences:
                compact_sentence = self._compact(sentence)
                if any(term in compact_sentence for term in entity_terms):
                    return sentence[:max_len]
        return ""

    @staticmethod
    def _compact(value: object) -> str:
        return re.sub(r"\s+", "", str(value or "")).lower()


evidence_validator = EvidenceValidator()
