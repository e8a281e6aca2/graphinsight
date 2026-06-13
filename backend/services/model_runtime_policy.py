"""Shared runtime policy helpers for unified reasoning profiles."""
from __future__ import annotations

from typing import Any, Dict, Optional


SUPPORTED_REASONING_PROFILES = {"fast", "balanced", "deep"}
REASONING_EFFORT_BY_PROFILE = {
    "fast": "low",
    "balanced": "medium",
    "deep": "high",
}


def normalize_reasoning_profile(reasoning_profile: Optional[str], fallback: str = "balanced") -> str:
    normalized = str(reasoning_profile or "").strip().lower()
    if normalized in SUPPORTED_REASONING_PROFILES:
        return normalized
    fallback_value = str(fallback or "").strip().lower()
    if fallback_value in SUPPORTED_REASONING_PROFILES:
        return fallback_value
    return "balanced"


def reasoning_max_tokens(reasoning_profile: Optional[str], *, fast: int, balanced: int, deep: int) -> int:
    profile = normalize_reasoning_profile(reasoning_profile, "balanced")
    if profile == "deep":
        return deep
    if profile == "balanced":
        return balanced
    return fast


def build_reasoning_options(reasoning_profile: Optional[str]) -> Optional[Dict[str, Any]]:
    profile = normalize_reasoning_profile(reasoning_profile, "balanced")
    effort = REASONING_EFFORT_BY_PROFILE.get(profile)
    if not effort:
        return None
    return {"reasoning": {"effort": effort}}


def apply_reasoning_profile(payload: Dict[str, Any], reasoning_profile: Optional[str]) -> Dict[str, Any]:
    next_payload = dict(payload)
    extra_body = build_reasoning_options(reasoning_profile)
    if extra_body:
        next_payload["extra_body"] = extra_body
    return next_payload
