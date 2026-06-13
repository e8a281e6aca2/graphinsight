"""NL2Cypher shared capability handlers."""
from __future__ import annotations

from typing import Dict, Optional

from fastapi import HTTPException, Request
from neo4j.exceptions import ServiceUnavailable
from pydantic import BaseModel

from services.nl2cypher_service import NL2CypherService


class NL2CypherRequest(BaseModel):
    """NL2Cypher request payload."""

    natural_language: str
    context: Optional[Dict] = None


async def execute_nl2cypher(
    nl_request: NL2CypherRequest,
    http_request: Request,
):
    if not nl_request.natural_language or not nl_request.natural_language.strip():
        raise HTTPException(status_code=400, detail="自然语言查询不能为空")

    try:
        nl2cypher_service = NL2CypherService()
        result = await nl2cypher_service.convert(
            nl_request.natural_language,
            nl_request.context,
        )
    except ServiceUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    return result
