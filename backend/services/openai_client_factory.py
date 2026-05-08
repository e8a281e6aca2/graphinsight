"""OpenAI/httpx client 工厂。"""
from __future__ import annotations

from typing import Optional

import httpx
from openai import AsyncOpenAI, OpenAI

from config import get_settings


settings = get_settings()


def build_httpx_client(*, timeout: float = 30.0) -> httpx.Client:
    return httpx.Client(timeout=timeout, trust_env=settings.http_client_trust_env)


def build_openai_client(*, api_key: str, base_url: Optional[str] = None, timeout: float = 30.0) -> OpenAI:
    kwargs = {
        "api_key": api_key,
        "http_client": build_httpx_client(timeout=timeout),
    }
    if base_url:
        kwargs["base_url"] = base_url
    return OpenAI(**kwargs)


def build_async_openai_client(*, api_key: str, base_url: Optional[str] = None, timeout: float = 30.0) -> AsyncOpenAI:
    http_client = httpx.AsyncClient(timeout=timeout, trust_env=settings.http_client_trust_env)
    kwargs = {
        "api_key": api_key,
        "http_client": http_client,
    }
    if base_url:
        kwargs["base_url"] = base_url
    return AsyncOpenAI(**kwargs)
