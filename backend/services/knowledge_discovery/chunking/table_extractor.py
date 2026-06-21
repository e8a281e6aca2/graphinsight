"""HTML table extraction utilities."""
from __future__ import annotations

import re
from html.parser import HTMLParser
from typing import Dict, List


class HTMLTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: List[List[str]] = []
        self._current_row: List[str] = []
        self._current_cell: List[str] = []
        self._in_cell = False

    def handle_starttag(self, tag: str, _attrs) -> None:
        if tag.lower() == "tr":
            self._current_row = []
        if tag.lower() in {"td", "th"}:
            self._in_cell = True
            self._current_cell = []

    def handle_data(self, data: str) -> None:
        if self._in_cell:
            self._current_cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        lowered = tag.lower()
        if lowered in {"td", "th"}:
            text = re.sub(r"\s+", " ", "".join(self._current_cell)).strip()
            self._current_row.append(text)
            self._current_cell = []
            self._in_cell = False
        if lowered == "tr" and self._current_row:
            self.rows.append(self._current_row)
            self._current_row = []


def parse_html_table(table_text: str) -> tuple[List[str], List[Dict[str, str]]]:
    parser = HTMLTableParser()
    try:
        parser.feed(table_text or "")
    except Exception:
        return [], []
    if not parser.rows:
        return [], []
    columns = [str(item or "").strip() for item in parser.rows[0]]
    rows: List[Dict[str, str]] = []
    for raw_row in parser.rows[1:]:
        item: Dict[str, str] = {}
        for index, value in enumerate(raw_row):
            column = columns[index] if index < len(columns) and columns[index] else f"column_{index + 1}"
            item[column] = str(value or "").strip()
        if any(item.values()):
            rows.append(item)
    return columns, rows


__all__ = ["HTMLTableParser", "parse_html_table"]
