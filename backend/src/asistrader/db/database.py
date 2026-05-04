"""Database connection and session management."""

import os
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://asistrader:asistrader@localhost:5432/asistrader",
)

# pool_pre_ping=True does a tiny `SELECT 1` before reusing a pooled connection,
# so DB restarts, network blips, or PgBouncer idle-timeouts don't surface as
# OperationalError on the next request. Tiny per-request cost, large
# reliability gain.
engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    """Dependency that provides a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
