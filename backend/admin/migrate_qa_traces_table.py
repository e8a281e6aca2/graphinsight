"""
创建问答链路追踪表（admin_qa_traces）
"""
from __future__ import annotations

import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from admin.database import engine  # noqa: E402
from admin.models import AdminQATrace  # noqa: F401,E402 - ensure model registration


def main() -> int:
    AdminQATrace.__table__.create(bind=engine, checkfirst=True)
    print("admin_qa_traces table is ready")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

