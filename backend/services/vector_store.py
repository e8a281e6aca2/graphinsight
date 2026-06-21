"""Milvus vector store adapter for document chunks."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from core import get_logger
from services.runtime_config import get_embedding_runtime_config, get_vector_store_runtime_config


logger = get_logger()


@dataclass
class VectorChunk:
    chunk_id: str
    doc_id: str
    text: str
    title: str = ""
    location: str = ""
    entities: List[str] = field(default_factory=list)
    content_hash: str = ""
    embedding_model: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class VectorSearchHit:
    chunk_id: str
    score: float
    metadata: Dict[str, Any] = field(default_factory=dict)


class MilvusVectorStore:
    def __init__(self) -> None:
        self._client = None
        self._client_key: Optional[tuple[str, str, str]] = None
        self._collection_ready = False

    def config(self) -> Dict[str, Any]:
        cfg = get_vector_store_runtime_config()
        cfg["provider"] = str(cfg.get("provider") or "milvus").strip().lower()
        cfg["collection"] = str(cfg.get("collection") or "graphinsight_chunks").strip()
        cfg["metric_type"] = str(cfg.get("metric_type") or "COSINE").strip().upper()
        cfg["index_type"] = str(cfg.get("index_type") or "IVF_FLAT").strip().upper()
        cfg["search_nprobe"] = max(1, int(cfg.get("search_nprobe") or 16))
        return cfg

    def is_enabled(self) -> bool:
        cfg = self.config()
        return bool(cfg.get("enabled")) and cfg.get("provider") == "milvus"

    def health(self) -> Dict[str, Any]:
        if not self.is_enabled():
            return {"ok": False, "enabled": False, "provider": "milvus"}
        try:
            client = self._get_client()
            collection = self.config()["collection"]
            collection_exists = bool(client.has_collection(collection))
            return {
                "ok": True,
                "enabled": True,
                "provider": "milvus",
                "collection": collection,
                "collection_exists": collection_exists,
            }
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "enabled": True, "provider": "milvus", "error": str(exc)}

    def ensure_collection(self, dimension: Optional[int] = None) -> None:
        if not self.is_enabled():
            return
        client = self._get_client()
        cfg = self.config()
        embedding_cfg = get_embedding_runtime_config()
        collection = cfg["collection"]
        vector_dimension = int(dimension or embedding_cfg.get("dimension") or 1536)

        if client.has_collection(collection):
            existing_dimension = self._collection_vector_dimension(client, collection)
            if existing_dimension and existing_dimension != vector_dimension:
                logger.warning(
                    "Milvus collection 维度与当前 embedding 不一致，已重建",
                    context={
                        "collection": collection,
                        "existing_dimension": existing_dimension,
                        "current_dimension": vector_dimension,
                    },
                )
                client.drop_collection(collection)
                self._collection_ready = False

        if not client.has_collection(collection):
            try:
                from pymilvus import DataType
            except Exception as exc:  # noqa: BLE001
                raise RuntimeError("缺少 pymilvus 依赖，无法初始化 Milvus collection") from exc

            schema = client.create_schema(auto_id=False, enable_dynamic_field=True)
            schema.add_field(field_name="chunk_id", datatype=DataType.VARCHAR, is_primary=True, max_length=128)
            schema.add_field(field_name="doc_id", datatype=DataType.VARCHAR, max_length=128)
            schema.add_field(field_name="text", datatype=DataType.VARCHAR, max_length=4096)
            schema.add_field(field_name="title", datatype=DataType.VARCHAR, max_length=512)
            schema.add_field(field_name="location", datatype=DataType.VARCHAR, max_length=128)
            schema.add_field(field_name="content_hash", datatype=DataType.VARCHAR, max_length=80)
            schema.add_field(field_name="embedding_model", datatype=DataType.VARCHAR, max_length=128)
            schema.add_field(field_name="entities_json", datatype=DataType.VARCHAR, max_length=2048)
            schema.add_field(field_name="vector", datatype=DataType.FLOAT_VECTOR, dim=vector_dimension)
            client.create_collection(collection_name=collection, schema=schema)

        index_params = client.prepare_index_params()
        index_params.add_index(
            field_name="vector",
            index_type=cfg["index_type"],
            metric_type=cfg["metric_type"],
            params={"nlist": 128},
        )
        try:
            client.create_index(collection_name=collection, index_params=index_params)
        except Exception as exc:  # noqa: BLE001
            if "index" not in str(exc).lower():
                logger.warning("创建 Milvus 向量索引失败", context={"error": str(exc)})
        try:
            client.load_collection(collection)
        except Exception as exc:  # noqa: BLE001
            logger.warning("加载 Milvus collection 失败", context={"collection": collection, "error": str(exc)})
        self._collection_ready = True

    def upsert_chunks(self, chunks: List[VectorChunk], vectors: List[List[float]]) -> int:
        if not self.is_enabled() or not chunks:
            return 0
        if len(chunks) != len(vectors):
            raise ValueError("chunks 与 vectors 数量不一致")
        vector_dimension = len(vectors[0]) if vectors and vectors[0] else None
        self.ensure_collection(dimension=vector_dimension)
        client = self._get_client()
        collection = self.config()["collection"]

        import json

        rows = []
        for chunk, vector in zip(chunks, vectors):
            rows.append(
                {
                    "chunk_id": chunk.chunk_id,
                    "doc_id": chunk.doc_id,
                    "text": (chunk.text or "")[:4096],
                    "title": (chunk.title or "")[:512],
                    "location": (chunk.location or "")[:128],
                    "content_hash": (chunk.content_hash or "")[:80],
                    "embedding_model": (chunk.embedding_model or "")[:128],
                    "entities_json": json.dumps(chunk.entities or [], ensure_ascii=False)[:2048],
                    "vector": vector,
                    **(chunk.metadata or {}),
                }
            )
        client.upsert(collection_name=collection, data=rows)
        return len(rows)

    def delete_doc(self, doc_id: str) -> None:
        if not self.is_enabled() or not doc_id:
            return
        client = self._get_client()
        collection = self.config()["collection"]
        if not client.has_collection(collection):
            return
        client.delete(
            collection_name=collection,
            filter=f'doc_id == "{self._escape_filter_value(doc_id)}"',
        )

    def clear(self) -> None:
        if not self.is_enabled():
            return
        client = self._get_client()
        collection = self.config()["collection"]
        if client.has_collection(collection):
            client.drop_collection(collection)
            self._collection_ready = False

    def search(self, vector: List[float], limit: int, filter_expr: str = "") -> List[VectorSearchHit]:
        if not self.is_enabled() or not vector:
            return []
        self.ensure_collection()
        cfg = self.config()
        result = self._get_client().search(
            collection_name=cfg["collection"],
            data=[vector],
            anns_field="vector",
            limit=max(1, int(limit or 10)),
            filter=filter_expr or "",
            output_fields=[
                "chunk_id",
                "doc_id",
                "text",
                "title",
                "location",
                "content_hash",
                "embedding_model",
                "entities_json",
            ],
            search_params={
                "metric_type": cfg["metric_type"],
                "params": {"nprobe": cfg["search_nprobe"]},
            },
        )
        hits: List[VectorSearchHit] = []
        first = result[0] if result else []
        for item in first:
            if isinstance(item, dict):
                entity = item.get("entity") or {}
                raw_id = item.get("id")
                raw_score = item.get("score", item.get("distance", 0.0))
            else:
                entity = getattr(item, "entity", None) or {}
                raw_id = getattr(item, "id", "")
                raw_score = getattr(item, "score", None)
                if raw_score is None:
                    raw_score = getattr(item, "distance", 0.0)
            if not isinstance(entity, dict):
                try:
                    entity = dict(entity)
                except Exception:
                    entity = {}
            chunk_id = str(entity.get("chunk_id") or raw_id or "")
            if not chunk_id:
                continue
            try:
                normalized_score = float(raw_score or 0.0)
            except Exception:
                normalized_score = 0.0
            hits.append(VectorSearchHit(chunk_id=chunk_id, score=normalized_score, metadata=entity))
        return hits

    def _get_client(self):
        cfg = self.config()
        key = (str(cfg.get("uri") or ""), str(cfg.get("token") or ""), str(cfg.get("db_name") or "default"))
        if self._client is not None and self._client_key == key:
            return self._client
        try:
            from pymilvus import MilvusClient
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError("缺少 pymilvus 依赖，请安装 backend/requirements.txt") from exc
        kwargs: Dict[str, Any] = {"uri": key[0], "db_name": key[2]}
        if key[1]:
            kwargs["token"] = key[1]
        self._client = MilvusClient(**kwargs)
        self._client_key = key
        self._collection_ready = False
        return self._client

    @staticmethod
    def _collection_vector_dimension(client, collection: str) -> Optional[int]:
        try:
            description = client.describe_collection(collection)
        except Exception:
            return None
        fields = description.get("fields") if isinstance(description, dict) else None
        if not isinstance(fields, list):
            return None
        for field in fields:
            if not isinstance(field, dict) or field.get("name") != "vector":
                continue
            params = field.get("params") or field.get("type_params") or {}
            try:
                return int(params.get("dim") or params.get("dimension") or 0) or None
            except Exception:
                return None
        return None

    @staticmethod
    def _escape_filter_value(value: str) -> str:
        return str(value).replace("\\", "\\\\").replace('"', '\\"')


vector_store = MilvusVectorStore()


__all__ = ["MilvusVectorStore", "VectorChunk", "VectorSearchHit", "vector_store"]
