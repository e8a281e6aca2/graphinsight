"""文档管理 API"""
import shutil
import time
from pathlib import Path
from typing import List

from fastapi import APIRouter, File, UploadFile

from config import get_settings
from core import success_response, error_response, get_logger

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


def _safe_filename(name: str) -> str:
    return Path(name).name


def _make_doc_id(path: Path) -> str:
    import hashlib

    return hashlib.sha1(str(path).encode("utf-8", errors="ignore")).hexdigest()[:12]


@router.get(
    "/documents",
    summary="获取文档列表",
    description="返回已上传文档列表",
)
async def list_documents():
    try:
        doc_dir = Path(settings.document_storage_path).resolve()
        doc_dir.mkdir(parents=True, exist_ok=True)

        items = []
        for file in doc_dir.rglob("*"):
            if not file.is_file():
                continue
            if file.suffix.lower() not in SUPPORTED_EXTS:
                continue
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
        return success_response(data={"items": items}, message="ok")
    except Exception as exc:  # noqa: BLE001
        logger.error("获取文档列表失败", context={"error": str(exc)})
        return error_response(message="获取文档列表失败", code=500)


@router.post(
    "/documents/upload",
    summary="上传文档",
    description="支持拖拽上传文档",
)
async def upload_documents(files: List[UploadFile] = File(...)):
    doc_dir = Path(settings.document_storage_path).resolve()
    doc_dir.mkdir(parents=True, exist_ok=True)

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
            uploaded.append({"name": target.name, "ext": ext, "size": target.stat().st_size})
        except Exception as exc:  # noqa: BLE001
            skipped.append({"name": filename, "reason": str(exc)})
        finally:
            await file.close()

    return success_response(
        data={"uploaded": uploaded, "skipped": skipped},
        message="上传完成",
    )
