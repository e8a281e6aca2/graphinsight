"""Dynamic extraction schema assembly."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, Iterable, List

from services.knowledge_discovery.profiling.document_types import DOCUMENT_TYPE_SPECS


@dataclass
class DynamicExtractionSchema:
    document_type: str = "unknown"
    domain: str = "general"
    entity_types: List[str] = field(default_factory=list)
    relation_types: List[str] = field(default_factory=list)
    attribute_types: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def to_prompt_payload(self) -> Dict[str, Any]:
        return {
            "document_type": self.document_type,
            "domain": self.domain,
            "entity_types": [{"name": item} for item in self.entity_types],
            "relation_types": [{"name": item} for item in self.relation_types],
            "attribute_types": [{"name": item} for item in self.attribute_types],
        }


def build_extraction_schema(profile: Dict[str, Any] | None) -> DynamicExtractionSchema:
    profile = profile or {}
    document_type = str(profile.get("document_type") or "unknown").strip() or "unknown"
    if document_type not in DOCUMENT_TYPE_SPECS:
        document_type = "unknown"
    spec = DOCUMENT_TYPE_SPECS[document_type]
    fallback_spec = DOCUMENT_TYPE_SPECS["unknown"]
    return DynamicExtractionSchema(
        document_type=document_type,
        domain=str(profile.get("domain") or "general").strip() or "general",
        entity_types=_unique([*spec.get("entity_types", []), *profile.get("suggested_entity_types", []), *fallback_spec["entity_types"]])[:18],
        relation_types=_unique([*spec.get("relation_types", []), *profile.get("suggested_relation_types", []), *fallback_spec["relation_types"]])[:18],
        attribute_types=_unique([*spec.get("attribute_types", []), *fallback_spec["attribute_types"]])[:12],
    )


def _unique(values: Iterable[object]) -> List[str]:
    result: List[str] = []
    seen = set()
    for value in values:
        text = str(value or "").strip()
        key = text.lower()
        if not text or key in seen:
            continue
        seen.add(key)
        result.append(text)
    return result
