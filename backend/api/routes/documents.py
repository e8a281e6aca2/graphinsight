"""文档管理 API"""
from __future__ import annotations

import json
import os
import shutil
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Query, UploadFile

from admin.api.deps import require_permission
from admin.models import AdminUser
from config import get_settings
from core import error_response, get_logger, success_response
from services.document_graph_service import DocumentGraphService

router = APIRouter()
logger = get_logger()
settings = get_settings()

SUPPORTED_EXTS = {
    ".txt",
    ".md",
    ".markdown",
    ".csv",
    ".json",
    ".log",
    ".docx",
    ".pdf",
}
SOFT_DELETE_DIR_NAME = ".trash"
SOFT_DELETE_META_SUFFIX = ".meta.json"
DEFAULT_SOFT_DELETE_RETENTION_DAYS = 7
DRY_RUN_PREVIEW_LIMIT = 20


def _safe_filename(name: str) -> str:
    return Path(name).name


def _make_doc_id(path: Path) -> str:
    import hashlib

    return hashlib.sha1(str(path).encode("utf-8", errors="ignore")).hexdigest()[:12]


def _iter_documents(doc_dir: Path) -> List[Path]:
    files: List[Path] = []
    for file in doc_dir.rglob("*"):
        if not file.is_file():
            continue
        if SOFT_DELETE_DIR_NAME in file.parts:
            continue
        if file.suffix.lower() not in SUPPORTED_EXTS:
            continue
        files.append(file)
    return files


def _resolve_doc_dirs() -> List[Path]:
    primary = Path(settings.document_storage_path).resolve()
    primary.mkdir(parents=True, exist_ok=True)
    fallback = (Path(__file__).resolve().parents[2] / "documents").resolve()
    if fallback != primary and fallback.exists():
        return [primary, fallback]
    return [primary]


def _primary_doc_dir() -> Path:
    primary = Path(settings.document_storage_path).resolve()
    primary.mkdir(parents=True, exist_ok=True)
    return primary


def _trash_dir() -> Path:
    path = _primary_doc_dir() / SOFT_DELETE_DIR_NAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def _soft_delete_retention_days() -> int:
    raw = os.getenv("DOC_SOFT_DELETE_RETENTION_DAYS", str(DEFAULT_SOFT_DELETE_RETENTION_DAYS))
    try:
        value = int(raw)
    except Exception:
        return DEFAULT_SOFT_DELETE_RETENTION_DAYS
    return max(1, value)


def _deleted_meta_path(trash_file: Path) -> Path:
    return Path(f"{trash_file}{SOFT_DELETE_META_SUFFIX}")


def _load_deleted_meta(meta_path: Path) -> Dict[str, Any] | None:
    try:
        data = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("读取回收站元数据失败", context={"meta": str(meta_path)})
        return None
    if not isinstance(data, dict):
        return None
    if not data.get("doc_id"):
        return None
    return data


def _is_within_any(path: Path, roots: List[Path]) -> bool:
    try:
        resolved = path.resolve()
    except Exception:
        return False
    for root in roots:
        try:
            resolved.relative_to(root.resolve())
            return True
        except Exception:
            continue
    return False


def _iter_deleted_meta_files() -> List[Path]:
    trash = _trash_dir()
    return [path for path in trash.rglob(f"*{SOFT_DELETE_META_SUFFIX}") if path.is_file()]


def _cleanup_expired_deleted_items() -> int:
    now_ms = int(time.time() * 1000)
    removed = 0
    for meta_path in _iter_deleted_meta_files():
        data = _load_deleted_meta(meta_path)
        if not data:
            continue
        expires_at = int(data.get("expires_at") or 0)
        if expires_at <= 0 or expires_at > now_ms:
            continue
        trash_path = Path(str(data.get("trash_path") or "")).resolve()
        try:
            if trash_path.exists():
                trash_path.unlink()
            meta_path.unlink(missing_ok=True)
            removed += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("清理过期回收站文件失败", context={"error": str(exc), "meta": str(meta_path)})
    return removed


def _list_deleted_items() -> List[Dict[str, Any]]:
    _cleanup_expired_deleted_items()
    items: List[Dict[str, Any]] = []
    for meta_path in _iter_deleted_meta_files():
        data = _load_deleted_meta(meta_path)
        if not data:
            continue
        trash_path = Path(str(data.get("trash_path") or ""))
        if not trash_path.exists():
            meta_path.unlink(missing_ok=True)
            continue
        expires_at = int(data.get("expires_at") or 0)
        deleted_at = int(data.get("deleted_at") or 0)
        remaining_ms = max(expires_at - int(time.time() * 1000), 0) if expires_at > 0 else None
        item = {
            "doc_id": str(data.get("doc_id")),
            "name": str(data.get("name") or trash_path.name),
            "ext": str(data.get("ext") or trash_path.suffix.lower()),
            "size": int(data.get("size") or 0),
            "original_path": str(data.get("original_path") or ""),
            "trash_path": str(trash_path),
            "deleted_at": deleted_at,
            "expires_at": expires_at,
            "remaining_ms": remaining_ms,
            "purge_graph": bool(data.get("purge_graph", True)),
            "operator": data.get("operator"),
        }
        items.append(item)
    items.sort(key=lambda item: int(item.get("deleted_at") or 0), reverse=True)
    return items


def _find_deleted_item(doc_id: str) -> Dict[str, Any] | None:
    for item in _list_deleted_items():
        if str(item.get("doc_id")) == doc_id:
            return item
    return None


def _collect_active_file_items() -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for doc_dir in _resolve_doc_dirs():
        for file in _iter_documents(doc_dir):
            stat = file.stat()
            items.append(
                {
                    "id": _make_doc_id(file),
                    "name": file.name,
                    "path": str(file),
                    "ext": file.suffix.lower(),
                    "size": stat.st_size,
                    "updated_at": int(stat.st_mtime * 1000),
                }
            )
    items.sort(key=lambda item: item["updated_at"], reverse=True)
    return items


def _find_file_by_doc_id(doc_id: str) -> Path | None:
    for doc_dir in _resolve_doc_dirs():
        for file in _iter_documents(doc_dir):
            if _make_doc_id(file) == doc_id:
                return file
    return None


def _has_graph_changes(graph: Dict[str, Any] | None) -> bool:
    if not graph:
        return False
    for key in ("documents", "chunks", "relations", "orphan_entities"):
        try:
            if int(graph.get(key) or 0) > 0:
                return True
        except Exception:
            continue
    return False


def _soft_delete_file(file_path: Path, *, doc_id: str, purge_graph: bool, operator: str | None) -> Dict[str, Any]:
    stat = file_path.stat()
    deleted_at = int(time.time() * 1000)
    expires_at = deleted_at + _soft_delete_retention_days() * 24 * 60 * 60 * 1000

    trash_dir = _trash_dir()
    suffix = file_path.suffix.lower()
    trash_file = trash_dir / f"{doc_id}_{deleted_at}{suffix}"
    idx = 1
    while trash_file.exists():
        trash_file = trash_dir / f"{doc_id}_{deleted_at}_{idx}{suffix}"
        idx += 1
    meta_path = _deleted_meta_path(trash_file)

    shutil.move(str(file_path), str(trash_file))
    metadata = {
        "doc_id": doc_id,
        "name": file_path.name,
        "ext": suffix,
        "size": int(stat.st_size),
        "original_path": str(file_path),
        "trash_path": str(trash_file),
        "deleted_at": deleted_at,
        "expires_at": expires_at,
        "purge_graph": bool(purge_graph),
        "operator": operator,
    }
    try:
        meta_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        # 元数据写入失败时回滚文件移动，避免“不可恢复”的伪软删除
        shutil.move(str(trash_file), str(file_path))
        raise
    return metadata


def _build_verification(
    *,
    before_active_docs: int,
    after_active_docs: int,
    before_graph: Dict[str, Any] | None,
    after_graph: Dict[str, Any] | None,
) -> Dict[str, Any]:
    checks: Dict[str, Any] = {
        "active_documents_non_increase": after_active_docs <= before_active_docs,
        "active_documents_delta": after_active_docs - before_active_docs,
    }
    if before_graph and after_graph:
        for key in ("documents", "chunks", "relations"):
            before_value = int(before_graph.get(key) or 0)
            after_value = int(after_graph.get(key) or 0)
            checks[f"graph_{key}_non_increase"] = after_value <= before_value
            checks[f"graph_{key}_delta"] = after_value - before_value
    return {
        "before": {
            "active_documents": before_active_docs,
            "graph": before_graph,
        },
        "after": {
            "active_documents": after_active_docs,
            "deleted_documents": len(_list_deleted_items()),
            "graph": after_graph,
        },
        "checks": checks,
    }


@router.get(
    "/documents",
    summary="获取文档列表",
    description="返回已上传文档列表",
)
async def list_documents(
    current_user: Optional[AdminUser] = Depends(require_permission("kb:read", resource="kb")),
):
    try:
        items = _collect_active_file_items()
        return success_response(data={"items": items}, message="ok")
    except Exception as exc:  # noqa: BLE001
        logger.error("获取文档列表失败", context={"error": str(exc)})
        return error_response(message="获取文档列表失败", code=500)


@router.get(
    "/documents/deleted",
    summary="获取回收站列表",
    description="返回软删除文档（恢复窗口内）",
)
async def list_deleted_documents(
    current_user: Optional[AdminUser] = Depends(require_permission("kb:read", resource="kb")),
):
    try:
        items = _list_deleted_items()
        return success_response(data={"items": items}, message="ok")
    except Exception as exc:  # noqa: BLE001
        logger.error("获取回收站列表失败", context={"error": str(exc)})
        return error_response(message="获取回收站列表失败", code=500)


@router.post(
    "/documents/upload",
    summary="上传文档",
    description="支持拖拽上传文档",
)
async def upload_documents(
    files: List[UploadFile] = File(...),
    current_user: Optional[AdminUser] = Depends(require_permission("kb:write", resource="kb")),
):
    doc_dir = _primary_doc_dir()

    uploaded = []
    skipped = []

    for file in files:
        filename = _safe_filename(file.filename or "")
        if not filename:
            skipped.append({"name": file.filename, "reason": "文件名无效"})
            continue
        ext = Path(filename).suffix.lower()
        if ext not in SUPPORTED_EXTS:
            skipped.append({"name": filename, "reason": "不支持的文件类型"})
            continue

        target = doc_dir / filename
        if target.exists():
            stamp = int(time.time())
            target = doc_dir / f"{target.stem}_{stamp}{target.suffix}"

        try:
            with target.open("wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            uploaded.append(
                {
                    "id": _make_doc_id(target),
                    "doc_id": _make_doc_id(target),
                    "name": target.name,
                    "path": str(target),
                    "ext": ext,
                    "size": target.stat().st_size,
                }
            )
        except Exception as exc:  # noqa: BLE001
            skipped.append({"name": filename, "reason": str(exc)})
        finally:
            await file.close()

    return success_response(
        data={"uploaded": uploaded, "skipped": skipped},
        message="上传完成",
    )


@router.delete(
    "/documents/{doc_id}",
    summary="删除单个文档",
    description="删除文档文件并清理该文档对应图谱数据；支持 dry-run 与软删除",
)
async def delete_document(
    doc_id: str,
    purge_graph: bool = Query(True, description="是否同时清理图谱"),
    soft_delete: bool = Query(True, description="是否执行软删除（进入回收站）"),
    dry_run: bool = Query(False, description="仅预览，不执行实际删除"),
    verify_after: bool = Query(True, description="是否返回删除后自动校验快照"),
    current_user: Optional[AdminUser] = Depends(require_permission("kb:delete", resource="kb")),
):
    try:
        file_path = _find_file_by_doc_id(doc_id)
        service = DocumentGraphService()
        before_active_docs = len(_collect_active_file_items())
        before_graph = service.get_graph_totals() if purge_graph else None
        graph_preview = service.preview_delete_document_graph(doc_id) if purge_graph else None

        if dry_run:
            if file_path is None and not _has_graph_changes(graph_preview):
                return error_response(message="文档不存在", code=404)
            after_estimate_graph = None
            if before_graph and graph_preview:
                after_estimate_graph = {
                    key: max(int(before_graph.get(key) or 0) - int(graph_preview.get(key) or 0), 0)
                    for key in ("documents", "chunks", "relations")
                }
            return success_response(
                data={
                    "doc_id": doc_id,
                    "dry_run": True,
                    "mode": "soft_delete" if soft_delete else "hard_delete",
                    "candidate_file": {
                        "exists": bool(file_path and file_path.exists()),
                        "name": file_path.name if file_path else None,
                        "path": str(file_path) if file_path else None,
                    },
                    "graph": graph_preview,
                    "verification_preview": {
                        "before_active_documents": before_active_docs,
                        "after_active_documents": max(before_active_docs - (1 if file_path else 0), 0),
                        "after_graph_estimate": after_estimate_graph,
                    },
                },
                message="删除预览完成",
            )

        file_deleted = False
        file_action = "none"
        deleted_entry = None
        if file_path and file_path.exists():
            if soft_delete:
                deleted_entry = _soft_delete_file(
                    file_path,
                    doc_id=doc_id,
                    purge_graph=purge_graph,
                    operator=(current_user.username if current_user else None),
                )
                file_action = "soft_deleted"
            else:
                file_path.unlink()
                file_action = "hard_deleted"
            file_deleted = True

        graph_stats = None
        if purge_graph:
            graph_stats = service.delete_document_graph(doc_id)

        if not file_deleted and not _has_graph_changes(graph_stats):
            return error_response(message="文档不存在", code=404)

        verification = None
        if verify_after:
            after_active_docs = len(_collect_active_file_items())
            after_graph = service.get_graph_totals() if purge_graph else None
            verification = _build_verification(
                before_active_docs=before_active_docs,
                after_active_docs=after_active_docs,
                before_graph=before_graph,
                after_graph=after_graph,
            )

        return success_response(
            data={
                "doc_id": doc_id,
                "dry_run": False,
                "mode": "soft_delete" if soft_delete else "hard_delete",
                "file_deleted": file_deleted,
                "file_action": file_action,
                "deleted_entry": deleted_entry,
                "graph": graph_stats,
                "verification": verification,
            },
            message="删除完成",
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("删除文档失败", context={"doc_id": doc_id, "error": str(exc)})
        return error_response(message="删除文档失败", code=500)


@router.post(
    "/documents/{doc_id}/restore",
    summary="恢复单个文档",
    description="从回收站恢复被软删除文档",
)
async def restore_document(
    doc_id: str,
    verify_after: bool = Query(True, description="是否返回恢复后自动校验快照"),
    current_user: Optional[AdminUser] = Depends(require_permission("kb:write", resource="kb")),
):
    try:
        item = _find_deleted_item(doc_id)
        if not item:
            return error_response(message="回收站中未找到该文档", code=404)

        trash_path = Path(str(item.get("trash_path"))).resolve()
        if not trash_path.exists():
            return error_response(message="回收站文件已不存在", code=404)

        before_active_docs = len(_collect_active_file_items())

        original_path = Path(str(item.get("original_path") or ""))
        target_path = original_path
        roots = _resolve_doc_dirs()
        if not _is_within_any(original_path, roots):
            target_path = _primary_doc_dir() / str(item.get("name") or trash_path.name)
        target_path.parent.mkdir(parents=True, exist_ok=True)

        if target_path.exists():
            stamp = int(time.time())
            target_path = target_path.with_name(f"{target_path.stem}_{stamp}{target_path.suffix}")

        shutil.move(str(trash_path), str(target_path))
        meta_path = _deleted_meta_path(trash_path)
        meta_path.unlink(missing_ok=True)

        restored_doc_id = _make_doc_id(target_path)
        verification = None
        if verify_after:
            after_active_docs = len(_collect_active_file_items())
            verification = _build_verification(
                before_active_docs=before_active_docs,
                after_active_docs=after_active_docs,
                before_graph=None,
                after_graph=None,
            )

        return success_response(
            data={
                "doc_id": restored_doc_id,
                "original_doc_id": doc_id,
                "restored_name": target_path.name,
                "restored_path": str(target_path),
                "graph_restored": False,
                "note": "仅恢复文档文件，图谱需重新构建",
                "verification": verification,
            },
            message="恢复完成",
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("恢复文档失败", context={"doc_id": doc_id, "error": str(exc)})
        return error_response(message="恢复文档失败", code=500)


@router.delete(
    "/documents",
    summary="清空知识库",
    description="清空所有已上传文档，并可联动清理图谱；支持 dry-run 与软删除",
)
async def clear_documents(
    purge_graph: bool = Query(True, description="是否同时清理图谱"),
    soft_delete: bool = Query(True, description="是否执行软删除（进入回收站）"),
    dry_run: bool = Query(False, description="仅预览，不执行实际清空"),
    verify_after: bool = Query(True, description="是否返回清空后自动校验快照"),
    current_user: Optional[AdminUser] = Depends(require_permission("kb:delete", resource="kb")),
):
    try:
        file_paths: List[Path] = []
        for doc_dir in _resolve_doc_dirs():
            file_paths.extend(_iter_documents(doc_dir))

        service = DocumentGraphService()
        before_active_docs = len(file_paths)
        before_graph = service.get_graph_totals() if purge_graph else None
        graph_preview = service.preview_clear_document_graph() if purge_graph else None

        if dry_run:
            return success_response(
                data={
                    "dry_run": True,
                    "mode": "soft_delete" if soft_delete else "hard_delete",
                    "candidate_files": before_active_docs,
                    "candidate_names_preview": [item.name for item in file_paths[:DRY_RUN_PREVIEW_LIMIT]],
                    "graph": graph_preview,
                },
                message="清空预览完成",
            )

        removed_files = 0
        removed_errors: List[str] = []
        deleted_entries: List[Dict[str, Any]] = []
        for file in file_paths:
            try:
                if soft_delete:
                    deleted_entries.append(
                        _soft_delete_file(
                            file,
                            doc_id=_make_doc_id(file),
                            purge_graph=purge_graph,
                            operator=(current_user.username if current_user else None),
                        )
                    )
                else:
                    file.unlink()
                removed_files += 1
            except Exception as exc:  # noqa: BLE001
                removed_errors.append(f"{file.name}: {exc}")
                logger.warning("删除文件失败", context={"file": str(file), "error": str(exc)})

        graph_stats = None
        if purge_graph:
            graph_stats = service.clear_document_graph()

        verification = None
        if verify_after:
            after_active_docs = len(_collect_active_file_items())
            after_graph = service.get_graph_totals() if purge_graph else None
            verification = _build_verification(
                before_active_docs=before_active_docs,
                after_active_docs=after_active_docs,
                before_graph=before_graph,
                after_graph=after_graph,
            )

        return success_response(
            data={
                "dry_run": False,
                "mode": "soft_delete" if soft_delete else "hard_delete",
                "removed_files": removed_files,
                "failed_files": len(removed_errors),
                "errors_preview": removed_errors[:DRY_RUN_PREVIEW_LIMIT],
                "soft_deleted_files": len(deleted_entries) if soft_delete else 0,
                "graph": graph_stats,
                "verification": verification,
            },
            message="知识库已清空",
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("清空知识库失败", context={"error": str(exc)})
        return error_response(message="清空知识库失败", code=500)
