"""
Documents soft-delete flow smoke check.

Validates:
1) delete dry-run preview
2) soft delete into trash
3) list deleted documents
4) restore from trash
5) cleanup temp file
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def _request(
    method: str,
    url: str,
    *,
    token: str | None = None,
    payload: dict | None = None,
) -> tuple[int, dict | str]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(raw)
            except Exception:
                return resp.status, raw
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            return exc.code, json.loads(raw)
        except Exception:
            return exc.code, raw


def _extract_data(body: dict | str) -> dict | list | None:
    if isinstance(body, dict):
        return body.get("data")
    return None


def _login(base: str, username: str, password: str) -> str:
    status, body = _request(
        "POST",
        f"{base}/api/v1/admin/auth/login",
        payload={"username": username, "password": password},
    )
    if status != 200:
        raise RuntimeError(f"LOGIN_FAIL status={status} body={body}")
    data = _extract_data(body)
    if not isinstance(data, dict) or not data.get("token"):
        raise RuntimeError(f"LOGIN_NO_TOKEN body={body}")
    return str(data["token"])


def _list_documents(base: str, token: str) -> list[dict]:
    status, body = _request("GET", f"{base}/api/documents", token=token)
    if status != 200:
        raise RuntimeError(f"LIST_DOCS_FAIL status={status} body={body}")
    data = _extract_data(body)
    items = data.get("items", []) if isinstance(data, dict) else []
    return items if isinstance(items, list) else []


def _list_deleted_documents(base: str, token: str) -> list[dict]:
    status, body = _request("GET", f"{base}/api/documents/deleted", token=token)
    if status != 200:
        raise RuntimeError(f"LIST_DELETED_FAIL status={status} body={body}")
    data = _extract_data(body)
    items = data.get("items", []) if isinstance(data, dict) else []
    return items if isinstance(items, list) else []


def _delete_document(
    base: str,
    token: str,
    doc_id: str,
    *,
    purge_graph: bool,
    soft_delete: bool,
    dry_run: bool,
    verify_after: bool,
) -> dict:
    query = urllib.parse.urlencode(
        {
            "purge_graph": str(bool(purge_graph)).lower(),
            "soft_delete": str(bool(soft_delete)).lower(),
            "dry_run": str(bool(dry_run)).lower(),
            "verify_after": str(bool(verify_after)).lower(),
        }
    )
    status, body = _request(
        "DELETE",
        f"{base}/api/documents/{doc_id}?{query}",
        token=token,
    )
    if status != 200:
        raise RuntimeError(f"DELETE_DOC_FAIL status={status} body={body}")
    data = _extract_data(body)
    if not isinstance(data, dict):
        raise RuntimeError(f"DELETE_DOC_INVALID body={body}")
    return data


def _restore_document(base: str, token: str, doc_id: str) -> dict:
    status, body = _request("POST", f"{base}/api/documents/{doc_id}/restore", token=token)
    if status != 200:
        raise RuntimeError(f"RESTORE_FAIL status={status} body={body}")
    data = _extract_data(body)
    if not isinstance(data, dict):
        raise RuntimeError(f"RESTORE_INVALID body={body}")
    return data


def _find_doc_by_name(items: list[dict], name: str) -> dict | None:
    for item in items:
        if str(item.get("name")) == name:
            return item
    return None


def main() -> int:
    base = os.getenv("ADMIN_BASE_URL", "http://127.0.0.1:8081").rstrip("/")
    username = os.getenv("ADMIN_EMAIL", "yh@qs.al")
    password = os.getenv("ADMIN_PASSWORD")
    token = os.getenv("ADMIN_TOKEN")

    if not token:
        if not password:
            print("MISSING_ADMIN_PASSWORD")
            return 1
        token = _login(base, username, password)
    docs = _list_documents(base, token)
    print(f"DOCS_BEFORE count={len(docs)}")

    if docs:
        first_path = Path(str(docs[0].get("path") or "")).resolve()
        target_dir = first_path.parent if first_path.exists() else (Path(__file__).resolve().parents[1] / "documents")
    else:
        target_dir = Path(__file__).resolve().parents[1] / "documents"
    target_dir.mkdir(parents=True, exist_ok=True)

    stamp = int(time.time() * 1000)
    test_name = f"codex_soft_delete_smoke_{stamp}.txt"
    test_path = target_dir / test_name
    test_path.write_text("codex soft delete smoke file\n", encoding="utf-8")
    print(f"TEMP_FILE_CREATED path={test_path}")

    docs = _list_documents(base, token)
    target_doc = _find_doc_by_name(docs, test_name)
    if not target_doc:
        print("TEMP_DOC_NOT_FOUND_IN_LIST")
        return 1
    doc_id = str(target_doc.get("id"))
    print(f"TEMP_DOC_ID id={doc_id}")

    preview = _delete_document(
        base,
        token,
        doc_id,
        purge_graph=False,
        soft_delete=True,
        dry_run=True,
        verify_after=False,
    )
    if not bool(preview.get("dry_run")):
        print(f"DRY_RUN_FLAG_INVALID data={preview}")
        return 1
    print("DRY_RUN_OK")

    deleted = _delete_document(
        base,
        token,
        doc_id,
        purge_graph=False,
        soft_delete=True,
        dry_run=False,
        verify_after=True,
    )
    if str(deleted.get("file_action")) != "soft_deleted":
        print(f"SOFT_DELETE_ACTION_INVALID data={deleted}")
        return 1
    print("SOFT_DELETE_OK")

    deleted_items = _list_deleted_documents(base, token)
    if not any(str(item.get("doc_id")) == doc_id for item in deleted_items):
        print("DELETED_LIST_MISSING_DOC")
        return 1
    print(f"DELETED_LIST_OK count={len(deleted_items)}")

    restored = _restore_document(base, token, doc_id)
    restored_doc_id = str(restored.get("doc_id") or "")
    if not restored_doc_id:
        print(f"RESTORE_DOC_ID_INVALID data={restored}")
        return 1
    print(f"RESTORE_OK new_doc_id={restored_doc_id}")

    cleanup = _delete_document(
        base,
        token,
        restored_doc_id,
        purge_graph=False,
        soft_delete=False,
        dry_run=False,
        verify_after=False,
    )
    if str(cleanup.get("file_action")) != "hard_deleted":
        print(f"CLEANUP_ACTION_INVALID data={cleanup}")
        return 1
    print("CLEANUP_OK")

    print("DOCUMENTS_SOFT_DELETE_FLOW_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
