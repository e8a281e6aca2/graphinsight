"""Entity normalization for LLM and table extraction outputs."""
from __future__ import annotations

import json
import re
from typing import Any, Iterable, List


_JUNK_VALUES = {
    "",
    "[",
    "]",
    "{",
    "}",
    "entity",
    "type",
    "name",
    "null",
    "none",
}


def normalize_entity_values(values: Iterable[Any], *, max_items: int = 12) -> List[str]:
    clean: List[str] = []
    seen = set()
    for value in values:
        for candidate in _candidate_names(value):
            name = normalize_entity_name(candidate)
            if not name:
                continue
            key = _dedupe_key(name)
            if key in seen:
                continue
            seen.add(key)
            clean.append(name)
            if len(clean) >= max_items:
                return clean
    return clean


def normalize_entity_name(value: Any) -> str:
    if isinstance(value, dict):
        value = _dict_name(value)
    if isinstance(value, (list, tuple)):
        return ""
    text = str(value or "").strip()
    if not text:
        return ""

    parsed = _parse_jsonish(text)
    if parsed is not None and parsed is not value:
        return normalize_entity_name(parsed)

    text = text.strip().strip('"').strip("'").strip()
    text = re.sub(r"^(?:[-*•]\s*|\d+[.、]\s+)", "", text).strip()
    text = re.sub(r"\s+", " ", text)
    text = text.replace("％", "%")
    text = _repair_spaced_chemical_name(text)
    text = text.strip(" ，,;；。:：[]【】{}")
    if not _is_valid_entity(text):
        return ""
    return text


def _candidate_names(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, dict):
        name = _dict_name(value)
        aliases = value.get("aliases") or value.get("alias") or []
        result: List[Any] = [name]
        if isinstance(aliases, list):
            result.extend(aliases)
        elif aliases:
            result.append(aliases)
        return result
    if isinstance(value, list):
        result: List[Any] = []
        for item in value:
            result.extend(_candidate_names(item))
        return result
    parsed = _parse_jsonish(str(value))
    if parsed is not None and parsed != value:
        return _candidate_names(parsed)
    return [value]


def _dict_name(value: dict[str, Any]) -> str:
    for key in ("name", "entity", "text", "value", "label", "term"):
        item = value.get(key)
        if isinstance(item, (str, int, float)) and str(item).strip():
            return str(item)
    return ""


def _parse_jsonish(text: str) -> Any | None:
    stripped = text.strip()
    if not stripped:
        return None
    if not (
        (stripped.startswith("{") and stripped.endswith("}"))
        or (stripped.startswith("[") and stripped.endswith("]"))
    ):
        return None
    for candidate in (stripped, stripped.replace("'", '"')):
        try:
            return json.loads(candidate)
        except Exception:
            continue
    match = re.search(r"""["']?(?:entity|name|text|value)["']?\s*:\s*["']([^"'}]+)""", stripped)
    if match:
        return match.group(1)
    return None


def _repair_spaced_chemical_name(text: str) -> str:
    text = re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", "", text)
    text = re.sub(r"(?<=\d)\s+(?=(?:mg|g|kg|mL|L)\b)", "", text, flags=re.IGNORECASE)
    text = re.sub(r"(?<=[%/A-Za-z])\s+(?=[\u4e00-\u9fff])", "", text)
    text = re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[A-Za-z])", "", text)
    text = re.sub(r"\b([A-Z])\s+([A-Z])\b", r"\1\2", text)
    return text


def _is_valid_entity(text: str) -> bool:
    lowered = text.lower().strip()
    if lowered in _JUNK_VALUES:
        return False
    if len(text) < 2 or len(text) > 80:
        return False
    if re.fullmatch(r"[\W_]+", text):
        return False
    if re.fullmatch(r"""type["']?\s*[:：].*""", lowered):
        return False
    if re.search(r"""["']?\s*:\s*["']?""", text) and ("entity" in lowered or "type" in lowered):
        return False
    return True


def _dedupe_key(text: str) -> str:
    return re.sub(r"\s+", "", text).lower()
