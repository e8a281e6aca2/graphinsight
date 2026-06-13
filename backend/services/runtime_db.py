"""Runtime DB dependency for Python capability routes."""
from __future__ import annotations

from typing import Generator

from sqlalchemy.orm import Session


def get_runtime_db() -> Generator[Session, None, None]:
    from admin.database import SessionLocal

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
