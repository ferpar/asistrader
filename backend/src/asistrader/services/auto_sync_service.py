"""Bundled auto-sync of user-relevant external data.

Hook target: /api/auth/me, called once per session start by the frontend's
AuthContext. Gap-detection in each downstream sync function makes this cheap
in steady state — DB-only bounds checks when data is current, yfinance only
when there's a real gap to fill.
"""

import logging
from datetime import date, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from asistrader.models.db import FundEvent, Ticker, Trade
from asistrader.services import benchmark_service, fx_service, market_data_service


logger = logging.getLogger(__name__)


# Default lookback when a user has no events / trades on file yet.
DEFAULT_LOOKBACK_DAYS = 365

# See fx_service.EARLIEST_DATE_BUFFER_DAYS — same rationale.
EARLIEST_DATE_BUFFER_DAYS = 14


def _user_ticker_symbols(db: Session, user_id: int) -> list[str]:
    rows = (
        db.query(Trade.ticker)
        .filter(Trade.user_id == user_id, Trade.ticker.isnot(None))
        .distinct()
        .all()
    )
    return sorted({row[0] for row in rows if row[0]})


def _user_oldest_date(db: Session, user_id: int) -> date:
    """Earliest event/trade date the user has, padded backward by
    EARLIEST_DATE_BUFFER_DAYS so the FX walk-back always has a weekday rate
    available even when the earliest event is on a weekend/holiday."""
    earliest_event = (
        db.query(func.min(FundEvent.event_date))
        .filter(FundEvent.user_id == user_id)
        .scalar()
    )
    earliest_trade = (
        db.query(func.min(Trade.date_planned))
        .filter(Trade.user_id == user_id)
        .scalar()
    )
    candidates = [d for d in (earliest_event, earliest_trade) if d is not None]
    if candidates:
        return min(candidates) - timedelta(days=EARLIEST_DATE_BUFFER_DAYS)
    return date.today() - timedelta(days=DEFAULT_LOOKBACK_DAYS)


def ensure_user_data_fresh(db: Session, user_id: int) -> dict:
    """Best-effort sync of FX rates, ticker market data, and benchmark market data.

    Each stage is wrapped individually so a single failure (e.g. yfinance
    flake) doesn't poison the others. Returns a summary keyed by stage:
        {"fx": {...}, "tickers": {...}, "benchmarks": {...}, "errors": {...}}

    Idempotent: gap detection inside each downstream function short-circuits
    when the data is already current — at most a few DB bounds queries.
    """
    summary: dict = {"fx": None, "tickers": None, "benchmarks": None, "errors": {}}
    since_date = _user_oldest_date(db, user_id)

    try:
        summary["fx"] = fx_service.ensure_rates_for_user(db, user_id)
    except Exception as e:
        logger.warning("Auto-sync: FX failed for user %s: %s", user_id, e)
        summary["errors"]["fx"] = str(e)

    try:
        symbols = _user_ticker_symbols(db, user_id)
        if symbols:
            summary["tickers"] = market_data_service.sync_all(db, since_date, symbols)
    except Exception as e:
        logger.warning("Auto-sync: tickers failed for user %s: %s", user_id, e)
        summary["errors"]["tickers"] = str(e)

    try:
        summary["benchmarks"] = benchmark_service.sync_all(db, since_date)
    except Exception as e:
        logger.warning("Auto-sync: benchmarks failed for user %s: %s", user_id, e)
        summary["errors"]["benchmarks"] = str(e)

    return summary
