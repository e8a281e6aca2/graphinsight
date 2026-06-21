"""Generic structure-aware chunker for parsed documents."""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

from services.document_parser import ParsedDocument
from services.knowledge_discovery.chunking.table_extractor import parse_html_table


@dataclass
class StructuredChunk:
    text: str
    block_type: str = "paragraph"
    heading_path: List[str] = field(default_factory=list)
    caption: str = ""
    neighbor_before: str = ""
    neighbor_after: str = ""
    table_columns: List[str] = field(default_factory=list)
    table_rows: List[Dict[str, str]] = field(default_factory=list)
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    source_location: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class StructuredChunker:
    """Split parsed text by document structure before falling back to length cuts."""

    def __init__(self, max_chars: int = 1600, min_chars: int = 30) -> None:
        self.max_chars = max_chars
        self.min_chars = min_chars

    def chunk(self, parsed: ParsedDocument, *, doc_id: str = "") -> List[StructuredChunk]:
        page_start, page_end = parsed.page_range()
        source_location = self._source_location(parsed, doc_id)
        text = self._normalize_text(parsed.text)
        if not text:
            return []

        lines = [line.strip() for line in text.splitlines()]
        chunks: List[StructuredChunk] = []
        heading_path: List[str] = []
        buffer: List[str] = []
        pending_caption = ""
        last_context = ""

        def flush_buffer() -> None:
            nonlocal buffer, last_context
            paragraph = "\n".join(line for line in buffer if line.strip()).strip()
            buffer = []
            if not paragraph:
                return
            for piece in self._split_long_text(paragraph):
                block_type = self._paragraph_type(piece, heading_path)
                chunks.append(
                    StructuredChunk(
                        text=piece,
                        block_type=block_type,
                        heading_path=list(heading_path),
                        page_start=page_start,
                        page_end=page_end,
                        source_location=source_location,
                    )
                )
                last_context = self._context_preview(piece)

        index = 0
        while index < len(lines):
            line = lines[index]
            if not line:
                index += 1
                continue

            heading = self._parse_heading(line)
            if heading:
                flush_buffer()
                level, title = heading
                if level <= len(heading_path):
                    heading_path = heading_path[: level - 1]
                while len(heading_path) < level - 1:
                    heading_path.append("")
                heading_path.append(title)
                index += 1
                continue

            if self._is_table_caption(line):
                flush_buffer()
                pending_caption = line
                index += 1
                continue

            if "<table" in line.lower():
                flush_buffer()
                table_lines = [line]
                while "</table>" not in line.lower() and index + 1 < len(lines):
                    index += 1
                    line = lines[index]
                    table_lines.append(line)
                table_text = "\n".join(table_lines).strip()
                columns, rows = parse_html_table(table_text)
                text_with_caption = f"{pending_caption}\n\n{table_text}".strip() if pending_caption else table_text
                chunks.append(
                    StructuredChunk(
                        text=text_with_caption,
                        block_type="table",
                        heading_path=list(heading_path),
                        caption=pending_caption,
                        neighbor_before=last_context,
                        table_columns=columns,
                        table_rows=rows,
                        page_start=page_start,
                        page_end=page_end,
                        source_location=source_location,
                    )
                )
                pending_caption = ""
                last_context = self._context_preview(text_with_caption)
                index += 1
                continue

            buffer.append(line)
            index += 1

        flush_buffer()
        self._attach_neighbor_after(chunks)
        return [chunk for chunk in chunks if len(chunk.text.strip()) >= self.min_chars or chunk.block_type == "table"]

    @staticmethod
    def _normalize_text(text: str) -> str:
        text = (text or "").replace("\xa0", " ").replace("\u3000", " ")
        text = re.sub(r"[ \t]+", " ", text)
        return text.strip()

    @staticmethod
    def _parse_heading(line: str) -> Optional[tuple[int, str]]:
        match = re.match(r"^(#{1,6})\s+(.+)$", line.strip())
        if not match:
            return None
        title = re.sub(r"\s+", " ", match.group(2)).strip()
        return (len(match.group(1)), title) if title else None

    @staticmethod
    def _is_table_caption(line: str) -> bool:
        return bool(re.match(r"^表\s*\d+[\s：:、.．-]*.+", line.strip()))

    @staticmethod
    def _paragraph_type(text: str, heading_path: List[str]) -> str:
        compact = re.sub(r"\s+", "", text)
        if "摘要" in compact[:20] or "[摘要" in compact[:20] or "[摘" in compact[:20]:
            return "abstract"
        if heading_path:
            return "section"
        return "paragraph"

    def _split_long_text(self, text: str) -> List[str]:
        if len(text) <= self.max_chars:
            return [text]
        sentences = re.split(r"(?<=[。！？!?；;])\s*", text)
        chunks: List[str] = []
        current = ""
        for sentence in sentences:
            if not sentence:
                continue
            if len(current) + len(sentence) + 1 <= self.max_chars:
                current = f"{current} {sentence}".strip()
                continue
            if current:
                chunks.append(current)
            if len(sentence) <= self.max_chars:
                current = sentence
            else:
                chunks.extend(sentence[i : i + self.max_chars] for i in range(0, len(sentence), self.max_chars))
                current = ""
        if current:
            chunks.append(current)
        return chunks

    @staticmethod
    def _source_location(parsed: ParsedDocument, doc_id: str) -> str:
        for block in parsed.blocks:
            if block.source_location:
                return block.source_location
        return doc_id

    @staticmethod
    def _context_preview(text: str, limit: int = 240) -> str:
        cleaned = re.sub(r"\s+", " ", text or "").strip()
        return cleaned[:limit]

    @staticmethod
    def _attach_neighbor_after(chunks: List[StructuredChunk]) -> None:
        for index, chunk in enumerate(chunks):
            if chunk.block_type != "table" or chunk.neighbor_after:
                continue
            for candidate in chunks[index + 1 :]:
                if candidate.block_type != "table" and candidate.text.strip():
                    chunk.neighbor_after = StructuredChunker._context_preview(candidate.text)
                    break
