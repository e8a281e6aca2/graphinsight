"""Helpers for reading dev runtime endpoints written by scripts/dev-backend.sh."""
from __future__ import annotations

import os
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
RUNTIME_ENV_FILE = REPO_ROOT / "logs" / "dev" / "runtime.env"


def _read_runtime_env() -> dict[str, str]:
    if not RUNTIME_ENV_FILE.exists():
        return {}
    data: dict[str, str] = {}
    for line in RUNTIME_ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key and value:
            data[key] = value
    return data


def resolve_base_url(env_key: str, fallback: str, *, prefer_runtime: bool = True) -> str:
    explicit = (os.getenv(env_key) or "").strip()
    runtime = _read_runtime_env()
    value = (runtime.get(env_key) or "").strip()
    if prefer_runtime and value:
        return value.rstrip("/")
    if explicit:
        return explicit.rstrip("/")
    if value:
        return value.rstrip("/")
    return fallback.rstrip("/")
