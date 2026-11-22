#!/usr/bin/env python3
"""Idempotent seed of the Curated Baskets from `curated_baskets.json`.

Curated Baskets have no admin UI: the JSON file next to this module is their
source of truth. Each entry is reconciled **by slug** — created if missing,
otherwise its name, description and members are brought in line with the
file — so it is safe to run on every container start:

    python -m asistrader.db.seed_baskets

Curated Baskets whose slug has left the file are kept untouched (removing one
is a deliberate, manual act). Unknown member symbols get a bare `tickers` row
without any network call; their metadata and history arrive with the next
market-data sync (every DB ticker is in the radar universe).

Honors DATABASE_URL.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import NamedTuple

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from asistrader.models.db import Base, Basket, BasketKind, BasketMember, Ticker

SEED_FILE = Path(__file__).parent / "curated_baskets.json"

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://asistrader:asistrader@localhost:5432/asistrader",
)


def load_curated_baskets(path: Path = SEED_FILE) -> list[dict]:
    """The Curated Basket specs: {slug, name, description?, members: [symbol]}."""
    return json.loads(path.read_text())["baskets"]


class SeedResult(NamedTuple):
    created: int  # Curated Baskets inserted because no row had that slug
    updated: int  # existing ones whose name, description or members changed


def _ensure_tickers(session: Session, symbols: set[str]) -> None:
    known = {s for (s,) in session.query(Ticker.symbol).filter(Ticker.symbol.in_(symbols))}
    session.add_all(Ticker(symbol=s) for s in sorted(symbols - known))


def seed_baskets(session: Session, specs: list[dict] | None = None) -> SeedResult:
    """Create missing Curated Baskets and reconcile existing ones by slug."""
    if specs is None:
        specs = load_curated_baskets()
    _ensure_tickers(session, {s for spec in specs for s in spec["members"]})

    created = 0
    updated = 0
    for spec in specs:
        members = list(dict.fromkeys(spec["members"]))  # dedupe, keep order
        description = spec.get("description")
        basket = session.query(Basket).filter_by(slug=spec["slug"]).first()
        if basket is None:
            session.add(
                Basket(
                    kind=BasketKind.CURATED.value,
                    owner_user_id=None,
                    slug=spec["slug"],
                    name=spec["name"],
                    description=description,
                    members=[BasketMember(ticker=s) for s in members],
                )
            )
            created += 1
            continue

        changed = False
        if basket.name != spec["name"] or basket.description != description:
            basket.name = spec["name"]
            basket.description = description
            changed = True
        current = {m.ticker for m in basket.members}
        wanted = set(members)
        if current != wanted:
            basket.members = [m for m in basket.members if m.ticker in wanted] + [
                BasketMember(ticker=s) for s in members if s not in current
            ]
            changed = True
        updated += changed

    if created or updated:
        session.commit()
    return SeedResult(created, updated)


def main() -> None:
    engine = create_engine(DATABASE_URL)
    Base.metadata.create_all(bind=engine)  # no-op when alembic already built the schema
    session = sessionmaker(bind=engine)()
    try:
        result = seed_baskets(session)
        total = len(load_curated_baskets())
        print(
            f"Curated Basket seed: {result.created} created, {result.updated} updated, "
            f"{total - result.created - result.updated} unchanged."
        )
    finally:
        session.close()


if __name__ == "__main__":
    main()
