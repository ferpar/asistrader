#!/usr/bin/env python3
"""Idempotent seed of the strategies the app needs to be useful out of the box.

This is intentionally separate from the demo-data seed (`scripts/seed_data.py`,
which also creates sample tickers/trades and is *not* run on startup). It only
ensures a small set of strategies exist, **upserting by name** — so it is safe to
run on every `docker-compose up`: it creates a strategy only if one with that
name is missing, and never duplicates or touches existing rows.

    python -m asistrader.db.seed_strategies

Honors DATABASE_URL.
"""

from __future__ import annotations

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from asistrader.models.db import Base, Strategy
from asistrader.services.strategies.engines import HISTORICAL_EXPECTED_DAYS

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://asistrader:asistrader@localhost:5432/asistrader",
)


def _default_strategies() -> list[dict]:
    """The strategies to ensure exist. Currently the stock automated engine."""
    return [
        dict(
            name="Historical Expected Days",
            automated=True,
            pe_method="speed_offset",
            sl_method="plr",
            tp_method="historical_expected_days",
            description="Automated: triple-barrier sweep recommending a holding horizon.",
            params=HISTORICAL_EXPECTED_DAYS.default_params(),
        ),
    ]


def seed_strategies(session: Session) -> int:
    """Create any missing default strategies (by name). Returns the count created."""
    created = 0
    for spec in _default_strategies():
        if session.query(Strategy).filter_by(name=spec["name"]).first():
            continue
        session.add(Strategy(**spec))
        created += 1
    if created:
        session.commit()
    return created


def main() -> None:
    engine = create_engine(DATABASE_URL)
    Base.metadata.create_all(bind=engine)  # no-op when alembic already built the schema
    session = sessionmaker(bind=engine)()
    try:
        created = seed_strategies(session)
        total = len(_default_strategies())
        print(f"Strategy seed: {created} created, {total - created} already present.")
    finally:
        session.close()


if __name__ == "__main__":
    main()
