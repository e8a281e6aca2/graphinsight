#!/usr/bin/env python3
"""Static guards for migration cleanup regressions."""

from __future__ import annotations

import ast
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _source(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def _find_function(tree: ast.AST, name: str) -> ast.AsyncFunctionDef | ast.FunctionDef:
    for node in ast.walk(tree):
        if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)) and node.name == name:
            return node
    raise AssertionError(f"function not found: {name}")


def _calls_method(node: ast.AST, method_name: str) -> bool:
    for child in ast.walk(node):
        if (
            isinstance(child, ast.Call)
            and isinstance(child.func, ast.Attribute)
            and child.func.attr == method_name
        ):
            return True
    return False


def _is_purge_graph_name(node: ast.AST) -> bool:
    return isinstance(node, ast.Name) and node.id == "purge_graph"


def _assert_graph_calls_guarded_by_purge_graph(function: ast.AST) -> None:
    guarded_call_ids: set[int] = set()
    call_ids: set[int] = set()

    for node in ast.walk(function):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "get_graph_totals"
        ):
            call_ids.add(id(node))

        if isinstance(node, ast.IfExp) and _is_purge_graph_name(node.test):
            for child in ast.walk(node.body):
                if (
                    isinstance(child, ast.Call)
                    and isinstance(child.func, ast.Attribute)
                    and child.func.attr == "get_graph_totals"
                ):
                    guarded_call_ids.add(id(child))

        if isinstance(node, ast.If) and _is_purge_graph_name(node.test):
            for stmt in node.body:
                for child in ast.walk(stmt):
                    if (
                        isinstance(child, ast.Call)
                        and isinstance(child.func, ast.Attribute)
                        and child.func.attr == "get_graph_totals"
                    ):
                        guarded_call_ids.add(id(child))

    unguarded = call_ids - guarded_call_ids
    if unguarded:
        raise AssertionError(f"{getattr(function, 'name', '<unknown>')} calls get_graph_totals without purge_graph guard")


def test_nl2cypher_status_uses_current_config_service() -> None:
    source = _source("api/routes/nl2cypher.py")
    if "admin.config_service" in source or "ConfigService.get_" in source:
        raise AssertionError("nl2cypher status must not use removed admin.config_service")
    if "admin.services.config_service" not in source or "SessionLocal" not in source:
        raise AssertionError("nl2cypher status must use current config_service with a database session")


def test_document_file_only_operations_do_not_require_graph_totals() -> None:
    tree = ast.parse(_source("api/routes/documents.py"))
    for name in ("delete_document", "clear_documents"):
        function = _find_function(tree, name)
        _assert_graph_calls_guarded_by_purge_graph(function)

    restore_function = _find_function(tree, "restore_document")
    if _calls_method(restore_function, "get_graph_totals"):
        raise AssertionError("restore_document must not call get_graph_totals; graph is rebuilt separately")


def main() -> int:
    test_nl2cypher_status_uses_current_config_service()
    test_document_file_only_operations_do_not_require_graph_totals()
    print("MIGRATION_CLEANUP_GUARDS_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
