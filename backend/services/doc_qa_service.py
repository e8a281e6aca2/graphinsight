"""基于 Neo4j 文档片段的 LLM 问答服务"""
from __future__ import annotations

import json
import re
from typing import List, Dict, Any

from openai import OpenAI

from config import get_settings
from core import get_logger
from services.neo4j_service import get_neo4j_service

logger = get_logger()
settings = get_settings()


class DocQAService:
    def __init__(self) -> None:
        self.enabled = settings.llm_enabled and bool(settings.llm_api_key)
        self.model = settings.llm_qa_model
        self.temperature = settings.llm_qa_temperature
        self.max_tokens = settings.llm_qa_max_tokens
        self.max_context = settings.llm_qa_max_context
        self._client = None
        if self.enabled:
            client_kwargs = {"api_key": settings.llm_api_key}
            if settings.llm_base_url:
                client_kwargs["base_url"] = settings.llm_base_url
            self._client = OpenAI(**client_kwargs)

    def answer(self, question: str, top_k: int) -> Dict[str, Any]:
        citations = self._retrieve_chunks(question, top_k)
        if not citations:
            return {
                "answer": "当前文档库没有找到相关内容，请先上传文档或调整问题。",
                "citations": [],
            }

        if not self.enabled or not self._client:
            return {
                "answer": "已找到相关文档片段，但当前未配置 LLM，无法生成完整回答。",
                "citations": citations,
            }

        context_blocks = []
        for item in citations[: self.max_context]:
            context_blocks.append(
                f"SOURCE {item['id']} | {item['title']} | {item.get('location','')}\n{item['text']}"
            )

        prompt = (
            "你是文档问答助手，只能使用提供的 SOURCE 内容回答问题。"
            "请给出简洁、结构化的回答。若信息不足，说明需要补充文档。"
            "输出 JSON 格式：{\"answer\": \"...\", \"used_chunk_ids\": [\"...\"]}"
        )

        try:
            response = self._client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": prompt},
                    {
                        "role": "user",
                        "content": f"问题：{question}\n\n上下文：\n" + "\n\n".join(context_blocks),
                    },
                ],
                temperature=self.temperature,
                max_tokens=self.max_tokens,
            )
            content = response.choices[0].message.content or ""
            parsed = self._parse_json(content)
            answer = parsed.get("answer") or "已生成答案。"
            used_ids = parsed.get("used_chunk_ids") or []
            if used_ids:
                filtered = [c for c in citations if c["id"] in set(used_ids)]
                if filtered:
                    citations = filtered
            return {"answer": answer, "citations": citations}
        except Exception as exc:  # noqa: BLE001
            logger.warning("文档问答 LLM 失败", context={"error": str(exc)})
            return {
                "answer": "已找到相关文档片段，但生成回答失败，请稍后重试。",
                "citations": citations,
            }

    def _retrieve_chunks(self, question: str, top_k: int) -> List[Dict[str, Any]]:
        service = get_neo4j_service()
        query = question.strip()
        if not query:
            return []

        items: List[Dict[str, Any]] = []
        with service.driver.session() as session:
            try:
                result = session.run(
                    """
                    CALL db.index.fulltext.queryNodes('chunkText', $q) YIELD node, score
                    OPTIONAL MATCH (d:Document)-[:HAS_CHUNK]->(node)
                    RETURN node AS c, d, score
                    ORDER BY score DESC
                    LIMIT $limit
                    """,
                    {"q": query, "limit": top_k},
                )
            except Exception:
                result = session.run(
                    """
                    MATCH (d:Document)-[:HAS_CHUNK]->(c:Chunk)
                    WHERE c.text CONTAINS $q
                    RETURN c, d
                    LIMIT $limit
                    """,
                    {"q": query, "limit": top_k},
                )

            for record in result:
                chunk = record.get("c")
                doc = record.get("d")
                if not chunk:
                    continue
                chunk_props = dict(chunk)
                doc_props = dict(doc) if doc else {}
                text = chunk_props.get("text", "") or ""
                index = chunk_props.get("index")
                items.append(
                    {
                        "id": str(chunk_props.get("chunk_id") or chunk.id),
                        "title": doc_props.get("name") or "文档片段",
                        "location": f"Chunk {index}" if index is not None else None,
                        "text": text,
                        "snippet": text[:160].strip() if text else "",
                    }
                )
        return items

    def _parse_json(self, content: str) -> Dict[str, Any]:
        content = content.strip()
        if not content:
            return {}
        try:
            return json.loads(content)
        except Exception:
            match = re.search(r"\{.*\}", content, re.S)
            if match:
                try:
                    return json.loads(match.group(0))
                except Exception:
                    return {}
        return {}


doc_qa_service = DocQAService()
