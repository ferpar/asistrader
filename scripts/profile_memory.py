#!/usr/bin/env python3
"""Measure how much memory the backend's heavy request paths need.

Seeds synthetic OHLCV data shaped like production (219 tickers, ~143k rows),
then runs each scenario in a fresh Python process against the real app and
reports, relative to the process right after import:

    peak     high-water mark while the scenario ran (ru_maxrss)
    settled  resident memory once the scenario returned
    trimmed  resident memory after glibc's malloc_trim(0), when available

Run it on Linux (glibc) to get numbers that match the container — e.g. inside
the backend image against a throwaway Postgres. It creates tables and WRITES
synthetic tickers/prices, so point it at a disposable database:

    DATABASE_URL=postgresql://... python scripts/profile_memory.py
    DATABASE_URL=postgresql://... python scripts/profile_memory.py --only bulk_radar
"""

import argparse
import ctypes
import gc
import json
import os
import resource
import subprocess
import sys
from datetime import date, timedelta

# Add backend src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend", "src"))

# Production shape as of 2026-11: 143,599 rows over 219 tickers.
DEFAULT_TICKERS = 219
DEFAULT_DAYS = 656
SYMBOL_PREFIX = "PRF"
RADAR_WINDOW_DAYS = 300  # frontend/src/domain/radar/indicatorBuild.ts startDate()
FORCE_REFRESH_CHUNK = 20  # market_data_service.BULK_HISTORY_CHUNK_SIZE


def _symbols(n: int) -> list[str]:
    return [f"{SYMBOL_PREFIX}{i:03d}" for i in range(n)]


def _business_days(n: int) -> list[date]:
    days: list[date] = []
    d = date.today() - timedelta(days=1)
    while len(days) < n:
        if d.weekday() < 5:
            days.append(d)
        d -= timedelta(days=1)
    return days[::-1]


def _rss_kb() -> int:
    with open("/proc/self/status") as f:
        for line in f:
            if line.startswith("VmRSS:"):
                return int(line.split()[1])
    raise RuntimeError("VmRSS not found")


def _malloc_trim() -> bool:
    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
        return True
    except (OSError, AttributeError):
        return False


# ── Seeding ──


def seed(n_tickers: int, n_days: int) -> None:
    import numpy as np
    from sqlalchemy import func
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    from asistrader.db.database import SessionLocal, engine
    from asistrader.db.seed_strategies import seed_strategies
    from asistrader.models.db import Base, MarketData, Ticker

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_strategies(db)
        symbols = _symbols(n_tickers)
        expected = n_tickers * n_days
        have = (
            db.query(func.count(MarketData.id))
            .filter(MarketData.ticker.like(f"{SYMBOL_PREFIX}%"))
            .scalar()
        )
        if have == expected:
            return
        print(f"Seeding {n_tickers} tickers x {n_days} days...", file=sys.stderr)
        db.query(MarketData).filter(MarketData.ticker.like(f"{SYMBOL_PREFIX}%")).delete(
            synchronize_session=False
        )
        for sym in symbols:
            db.merge(Ticker(symbol=sym, currency="USD", price_hint=2))
        db.commit()

        rng = np.random.default_rng(42)
        days = _business_days(n_days)
        for sym in symbols:
            close = 100 * np.exp(np.cumsum(rng.normal(0, 0.02, n_days)))
            spread = np.abs(rng.normal(0, 0.01, n_days)) * close
            rows = [
                {
                    "ticker": sym,
                    "date": d,
                    "open": float(c - s / 2),
                    "high": float(c + s),
                    "low": float(c - s),
                    "close": float(c),
                    "volume": float(rng.integers(1e5, 1e7)),
                }
                for d, c, s in zip(days, close, spread)
            ]
            db.execute(pg_insert(MarketData).values(rows))
        db.commit()
    finally:
        db.close()


# ── Scenarios ──
#
# Each takes a TestClient and the seeded symbols. They exercise the request
# paths the frontend actually uses, minus the network calls to Yahoo.


def scenario_bulk_radar(client, symbols: list[str]) -> None:
    """The radar's bulk read: every ticker, last 300 days."""
    start = (date.today() - timedelta(days=RADAR_WINDOW_DAYS)).isoformat()
    r = client.post("/api/market-data/bulk", json={"symbols": symbols, "start_date": start})
    r.raise_for_status()


def scenario_bulk_radar_x3(client, symbols: list[str]) -> None:
    """Three radar loads back to back — does memory get reused or ratchet?"""
    for _ in range(3):
        scenario_bulk_radar(client, symbols)


def _draft(client, symbols: list[str], strategy_name: str) -> None:
    from asistrader.db.database import SessionLocal
    from asistrader.models.db import Strategy, SweepResultCache

    db = SessionLocal()
    try:
        db.query(SweepResultCache).delete()
        db.commit()
        strategy_id = db.query(Strategy.id).filter(Strategy.name == strategy_name).scalar()
    finally:
        db.close()
    if strategy_id is None:
        raise RuntimeError(f"Strategy {strategy_name!r} not seeded")
    # The live-price re-anchor would call Yahoo; with no quote it falls back.
    from asistrader.services.strategies import draft_service

    draft_service.get_current_price = lambda _symbol: {"valid": False}
    r = client.post(f"/api/strategies/{strategy_id}/draft", json={"ticker": symbols[0]})
    r.raise_for_status()


def scenario_draft_hed(client, symbols: list[str]) -> None:
    """Uncached Historical Expected Days draft for one ticker."""
    _draft(client, symbols, "Historical Expected Days")


def scenario_draft_dm(client, symbols: list[str]) -> None:
    """Uncached Dispersion and Momentum draft for one ticker."""
    _draft(client, symbols, "Dispersion and Momentum")


def scenario_store_chunk(client, symbols: list[str]) -> None:
    """One force-refresh chunk's upsert: 20 tickers' full history."""
    import pandas as pd

    from asistrader.db.database import SessionLocal
    from asistrader.services.market_data_service import get_market_data, store_market_data

    db = SessionLocal()
    try:
        for sym in symbols[:FORCE_REFRESH_CHUNK]:
            rows = get_market_data(db, sym)
            df = pd.DataFrame(
                {
                    "Open": [r.open for r in rows],
                    "High": [r.high for r in rows],
                    "Low": [r.low for r in rows],
                    "Close": [r.close for r in rows],
                    "Volume": [r.volume for r in rows],
                },
                index=pd.DatetimeIndex([r.date for r in rows]),
            )
            db.expunge_all()
            store_market_data(db, sym, df)
    finally:
        db.close()


SCENARIOS = {
    name.removeprefix("scenario_"): fn
    for name, fn in globals().items()
    if name.startswith("scenario_")
}


def run_scenario(name: str, n_tickers: int) -> dict:
    """Child process: import the app, measure, run one scenario, measure."""
    from fastapi.testclient import TestClient

    from asistrader.main import app

    client = TestClient(app)
    client.get("/health")
    gc.collect()
    base = _rss_kb()

    SCENARIOS[name](client, _symbols(n_tickers))

    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    gc.collect()
    settled = _rss_kb()
    trimmed = _rss_kb() if _malloc_trim() else None
    return {
        "scenario": name,
        "base_mb": base / 1024,
        "peak_mb": (peak - base) / 1024,
        "settled_mb": (settled - base) / 1024,
        "trimmed_mb": None if trimmed is None else (trimmed - base) / 1024,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--tickers", type=int, default=DEFAULT_TICKERS)
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS)
    parser.add_argument("--only", choices=sorted(SCENARIOS), action="append")
    parser.add_argument("--scenario", choices=sorted(SCENARIOS), help=argparse.SUPPRESS)
    args = parser.parse_args()

    if args.scenario:
        print(json.dumps(run_scenario(args.scenario, args.tickers)))
        return

    seed(args.tickers, args.days)
    print(f"{'scenario':<16}{'base':>8}{'peak':>10}{'settled':>10}{'trimmed':>10}   (MB)")
    for name in args.only or SCENARIOS:
        out = subprocess.run(
            [sys.executable, __file__, "--scenario", name, "--tickers", str(args.tickers)],
            capture_output=True,
            text=True,
            check=True,
        )
        r = json.loads(out.stdout.strip().splitlines()[-1])
        trimmed = "n/a" if r["trimmed_mb"] is None else f"{r['trimmed_mb']:+.1f}"
        print(
            f"{name:<16}{r['base_mb']:>8.1f}{r['peak_mb']:>+10.1f}"
            f"{r['settled_mb']:>+10.1f}{trimmed:>10}"
        )


if __name__ == "__main__":
    main()
