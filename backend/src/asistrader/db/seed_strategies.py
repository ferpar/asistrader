#!/usr/bin/env python3
"""Idempotent seed of the strategies the app needs to be useful out of the box.

This is intentionally separate from the demo-data seed (`scripts/seed_data.py`,
which also creates sample tickers/trades and is *not* run on startup). It only
ensures a small set of strategies exist, **upserting by name** — so it is safe to
run on every `docker-compose up`: it creates a strategy only if one with that
name is missing, and otherwise reconciles code-defined *structural* params onto
the existing row (see `seed_strategies`).

    python -m asistrader.db.seed_strategies

Honors DATABASE_URL.
"""

from __future__ import annotations

import os
from typing import NamedTuple

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from asistrader.models.db import Base, Strategy
from asistrader.services.strategies.engines import (
    DISPERSION_MOMENTUM,
    HISTORICAL_EXPECTED_DAYS,
)

# Structural params that have no scalar admin widget yet — seeded explicitly on
# top of the engine's scalar defaults (see docs/dispersion-momentum-strategy.md).
_DM_STRUCTURAL = {
    "scales": ["drift", "range"],
    "range_target_coefs": [0.3, 0.5, 0.8, 1.0],
    "range_time_barriers": [5, 10, 15, 20, 30, 40],
    # Swept speed-blend variants (slow-window weight along the persistence axis):
    # smooth 50d (= HED), balanced 50/50, reactive 50/5 @ 20%.
    "drift_speed_blends": [
        [[50, 1.0]],
        [[50, 0.5], [5, 0.5]],
        [[50, 0.2], [5, 0.8]],
    ],
}

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
            structural={},
        ),
        dict(
            name="Dispersion and Momentum",
            automated=True,
            pe_method="scale_offset",
            sl_method="plr",
            tp_method="dispersion_momentum",
            description=(
                "Automated: dual-scale triple-barrier sweep (blended momentum + "
                "30-day dispersion) recommending whichever scale historically paid better."
            ),
            params={**DISPERSION_MOMENTUM.default_params(), **_DM_STRUCTURAL},
            structural=_DM_STRUCTURAL,
        ),
    ]


class SeedResult(NamedTuple):
    created: int  # strategies inserted because no row with that name existed
    reconciled: int  # existing strategies whose structural params were backfilled


def seed_strategies(session: Session) -> SeedResult:
    """Create missing default strategies and backfill *structural* params on existing ones.

    Structural params (e.g. `drift_speed_blends`) are code-defined and have no
    admin widget, so the only way they change is in this file. A strategy seeded
    before such a param was added would otherwise keep a stale/missing value
    forever — the by-name guard skips existing rows. Reconciling them here is
    what keeps the engine config from silently drifting out of sync.

    Only the keys in a spec's `structural` dict are touched; admin-editable scalar
    params (PLR, windows, gates, …) are never overwritten.
    """
    created = 0
    reconciled = 0
    for spec in _default_strategies():
        structural = spec.pop("structural", {})
        existing = session.query(Strategy).filter_by(name=spec["name"]).first()
        if existing is None:
            session.add(Strategy(**spec))
            created += 1
            continue
        if not structural:
            continue
        current = dict(existing.params or {})
        if any(current.get(k) != v for k, v in structural.items()):
            # Reassign (not in-place mutate) so SQLAlchemy flags the JSON column dirty.
            existing.params = {**current, **structural}
            reconciled += 1
    if created or reconciled:
        session.commit()
    return SeedResult(created, reconciled)


def main() -> None:
    engine = create_engine(DATABASE_URL)
    Base.metadata.create_all(bind=engine)  # no-op when alembic already built the schema
    session = sessionmaker(bind=engine)()
    try:
        result = seed_strategies(session)
        total = len(_default_strategies())
        print(
            f"Strategy seed: {result.created} created, "
            f"{total - result.created} already present, "
            f"{result.reconciled} reconciled."
        )
    finally:
        session.close()


if __name__ == "__main__":
    main()
