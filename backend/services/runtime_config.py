"""Runtime config helpers for Python capability and worker layers."""
from __future__ import annotations

from typing import Any, Dict

from config import get_settings


settings = get_settings()


def _load_category(category: str) -> Dict[str, str]:
    try:
        from admin.database import SessionLocal
        from admin.crud.config import config_crud

        db = SessionLocal()
        try:
            rows = config_crud.get_by_category(db, category)
            result: Dict[str, str] = {}
            for row in rows:
                key = str(getattr(row, "key", "") or "").strip()
                if key:
                    result[key] = str(getattr(row, "value", "") or "")
            return result
        finally:
            db.close()
    except Exception:
        return {}


def _to_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _to_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _to_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except Exception:
        return default


def get_ai_runtime_config() -> Dict[str, Any]:
    loaded = _load_category("ai_service")
    api_key = loaded.get("api_key", settings.openai_api_key)
    return {
        "provider": loaded.get("provider", "openai"),
        "enabled": _to_bool(loaded.get("enabled"), True),
        "base_url": loaded.get("base_url", ""),
        "api_key": api_key,
        "model": loaded.get("model", settings.openai_model),
        "temperature": _to_float(loaded.get("temperature"), settings.openai_temperature),
        "max_tokens": _to_int(loaded.get("max_tokens"), settings.openai_max_tokens),
        "docqa_reasoning_profile": loaded.get("docqa_reasoning_profile", "balanced"),
        "deep_research_reasoning_profile": loaded.get("deep_research_reasoning_profile", "deep"),
        "model_probe_reasoning_profile": loaded.get("model_probe_reasoning_profile", "fast"),
        "graph_extract_reasoning_profile": loaded.get("graph_extract_reasoning_profile", "fast"),
        "graph_extract_complex_reasoning_profile": loaded.get("graph_extract_complex_reasoning_profile", "balanced"),
    }


def get_ai_cost_runtime_config() -> Dict[str, Any]:
    loaded = _load_category("ai_cost")
    return {
        "model_pricing_json": loaded.get("model_pricing_json", ""),
        "currency": loaded.get("currency", ""),
    }


def get_nl2cypher_runtime_config() -> Dict[str, Any]:
    loaded = _load_category("nl2cypher")
    return {
        "enabled": _to_bool(loaded.get("enabled"), settings.nl2cypher_enabled),
        "cache_size": _to_int(loaded.get("cache_size"), 100),
        "max_limit": _to_int(loaded.get("max_limit"), settings.nl2cypher_max_limit),
    }


def get_graph_build_runtime_defaults(*, complex_extraction: bool) -> str:
    ai_config = get_ai_runtime_config()
    key = "graph_extract_complex_reasoning_profile" if complex_extraction else "graph_extract_reasoning_profile"
    fallback = "balanced" if complex_extraction else "fast"
    value = str(ai_config.get(key, fallback) or "").strip().lower()
    if value in {"fast", "balanced", "deep"}:
        return value
    return fallback


def get_neo4j_runtime_config() -> Dict[str, str]:
    loaded = _load_category("neo4j")
    user = loaded.get("user") or loaded.get("username") or settings.neo4j_user
    return {
        "uri": loaded.get("uri", settings.neo4j_uri),
        "user": user,
        "password": loaded.get("password", settings.neo4j_password),
        "database": loaded.get("database", getattr(settings, "neo4j_database", "neo4j")),
    }
