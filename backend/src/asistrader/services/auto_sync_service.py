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

from asistrader.models.db import (
    FundEvent,
    Portfolio,
    PortfolioTransaction,
    Trade,
)
from asistrader.services import (
    basket_service,
    benchmark_service,
    fx_service,
    market_data_service,
)


logger = logging.getLogger(__name__)


# Default lookback when a user has no events / trades on file yet.
DEFAULT_LOOKBACK_DAYS = 365

# See fx_service.EARLIEST_DATE_BUFFER_DAYS — same rationale.
EARLIEST_DATE_BUFFER_DAYS = 14


def _user_ticker_symbols(db: Session, user_id: int) -> list[str]:
    """Tickers the user trades plus tickers in any of their Portfolios."""
    trade_rows = (
        db.query(Trade.ticker)
        .filter(Trade.user_id == user_id, Trade.ticker.isnot(None))
        .distinct()
        .all()
    )
    portfolio_rows = (
        db.query(PortfolioTransaction.ticker)
        .join(Portfolio, Portfolio.id == PortfolioTransaction.portfolio_id)
        .filter(Portfolio.user_id == user_id)
        .distinct()
        .all()
    )
    return sorted({row[0] for row in (*trade_rows, *portfolio_rows) if row[0]})


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
    earliest_transaction = (
        db.query(func.min(PortfolioTransaction.date))
        .join(Portfolio, Portfolio.id == PortfolioTransaction.portfolio_id)
        .filter(Portfolio.user_id == user_id)
        .scalar()
    )
    candidates = [
        d
        for d in (earliest_event, earliest_trade, earliest_transaction)
        if d is not None
    ]
    if candidates:
        return min(candidates) - timedelta(days=EARLIEST_DATE_BUFFER_DAYS)
    return date.today() - timedelta(days=DEFAULT_LOOKBACK_DAYS)


def _visible_basket_members(db: Session, user_id: int) -> list[str]:
    """Members of every Basket the user can see (Curated + their Personal)."""
    return sorted(
        {m.ticker for b in basket_service.get_visible_baskets(db, user_id) for m in b.members}
    )


def ensure_user_data_fresh(db: Session, user_id: int) -> dict:
    """Best-effort sync of FX rates, ticker market data, Basket members and
    benchmark market data.

    Each stage is wrapped individually so a single failure (e.g. yfinance
    flake) doesn't poison the others. Returns a summary keyed by stage:
        {"fx": {...}, "tickers": {...}, "basket_members": {...},
         "benchmarks": {...}, "history": {...}, "errors": {...}}

    Basket members are synced over the radar window
    (`basket_service.MEMBER_HISTORY_DAYS`), so the Basket ranking and its
    Momentum Scores are current.

    Last, the user's tickers and Basket members not yet repaired get their
    history repaired once (`market_data_service.repair_ticker_history`):
    adjusted closes, instrument metadata and split events that tickers stored
    before those were recorded lack.

    Idempotent: gap detection inside each downstream function short-circuits
    when the data is already current — at most a few DB bounds queries.
    """
    summary: dict = {
        "fx": None,
        "tickers": None,
        "basket_members": None,
        "benchmarks": None,
        "history": None,
        "errors": {},
    }
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
        members = _visible_basket_members(db, user_id)
        if members:
            radar_start = date.today() - timedelta(days=basket_service.MEMBER_HISTORY_DAYS)
            summary["basket_members"] = market_data_service.sync_all(db, radar_start, members)
    except Exception as e:
        logger.warning("Auto-sync: Basket members failed for user %s: %s", user_id, e)
        summary["errors"]["basket_members"] = str(e)

    try:
        summary["benchmarks"] = benchmark_service.sync_all(db, since_date)
    except Exception as e:
        logger.warning("Auto-sync: benchmarks failed for user %s: %s", user_id, e)
        summary["errors"]["benchmarks"] = str(e)

    try:
        symbols = sorted(
            set(_user_ticker_symbols(db, user_id)) | set(_visible_basket_members(db, user_id))
        )
        if symbols:
            summary["history"] = market_data_service.repair_ticker_history(db, symbols)
    except Exception as e:
        logger.warning("Auto-sync: history repair failed for user %s: %s", user_id, e)
        summary["errors"]["history"] = str(e)

    return summary
