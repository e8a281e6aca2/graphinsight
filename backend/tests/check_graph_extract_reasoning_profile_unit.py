#!/usr/bin/env python3
"""Unit-style checks for graph_extract reasoning profile propagation."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch


BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    from services.document_graph_service import DocumentGraphService

    service = DocumentGraphService()
    entity_calls: list[str | None] = []
    relation_calls: list[str | None] = []

    with patch("services.document_graph_service.llm_entity_extractor.extract") as entity_extract, patch(
        "services.document_graph_service.llm_relation_extractor.extract"
    ) as relation_extract:
        entity_extract.side_effect = lambda text, reasoning_profile=None: entity_calls.append(reasoning_profile) or ["Alpha", "Beta"]
        relation_extract.side_effect = (
            lambda text, entities, reasoning_profile=None: relation_calls.append(reasoning_profile) or [{"source": "Alpha", "target": "Beta", "label": "related"}]
        )

        entities = service._extract_entities("Alpha Beta", reasoning_profile="fast")
        relations = service._extract_relations("Alpha Beta", entities, reasoning_profile="balanced")

    _assert(entities == ["Alpha", "Beta"], f"unexpected entities: {entities}")
    _assert(len(relations) == 1, f"unexpected relations: {relations}")
    _assert(entity_calls == ["fast"], f"unexpected entity reasoning calls: {entity_calls}")
    _assert(relation_calls == ["balanced"], f"unexpected relation reasoning calls: {relation_calls}")
    print("GRAPH_EXTRACT_REASONING_PROFILE_UNIT_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
