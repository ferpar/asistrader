"""Database connection and session management."""

import os
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://asistrader:asistrader@localhost:5432/asistrader",
)


def _int_env(name: str, default: int) -> int:
    """Read an int from the environment, falling back on anything unparseable."""
    try:
        return int(os.environ[name])
    except (KeyError, ValueError):
        return default


# ── Connection pool ──
#
# SQLAlchemy's defaults (pool_size=5, max_overflow=10) cap us at 15 connections.
# Several endpoints do external HTTP (yfinance) while holding a connection, so
# 15 slow requests are enough to starve everything else — including the auth
# dependency behind /me and /login, which then fail with
# "QueuePool limit of size 5 overflow 10 reached" after a 30s wait. That is a
# self-imposed ceiling, not a database one: Postgres here allows 100
# connections and steady-state usage sits near 5.
#
# pool_timeout is deliberately shorter than the default 30s. A caller that
# can't get a connection quickly should fail fast and surface a real error
# rather than hang long enough to look like a frozen server.
POOL_SIZE = _int_env("DB_POOL_SIZE", 20)
MAX_OVERFLOW = _int_env("DB_MAX_OVERFLOW", 10)
POOL_TIMEOUT_SECONDS = _int_env("DB_POOL_TIMEOUT", 10)
# Recycle below typical idle-connection reapers (PgBouncer, cloud proxies) so
# we never hand out a socket the other end has already dropped.
POOL_RECYCLE_SECONDS = _int_env("DB_POOL_RECYCLE", 1800)

# pool_pre_ping=True does a tiny `SELECT 1` before reusing a pooled connection,
# so DB restarts, network blips, or PgBouncer idle-timeouts don't surface as
# OperationalError on the next request. Tiny per-request cost, large
# reliability gain.
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=POOL_SIZE,
    max_overflow=MAX_OVERFLOW,
    pool_timeout=POOL_TIMEOUT_SECONDS,
    pool_recycle=POOL_RECYCLE_SECONDS,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    """Dependency that provides a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
