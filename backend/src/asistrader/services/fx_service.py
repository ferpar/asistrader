"""FX rate service.

Stores daily exchange rates against USD as the anchor. Conversion between any
two currencies triangulates through USD:

    amount_in_to_ccy = amount × rate_to_usd(from, on_date) / rate_to_usd(to, on_date)

Reads always hit the local `fx_rates` table; yfinance is only consulted when
`sync_fx_*` runs and detects a gap. Mirrors the gap-fill pattern used by
`market_data_service.sync_ticker`.
"""

from datetime import date, timedelta

import pandas as pd
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from asistrader.models.db import FxRate
from asistrader.services.market_data_service import (
    fetch_from_yfinance,
    get_last_trading_day,
    get_next_trading_day,
)


# Maximum days back we'll walk to find a rate (covers long weekends + holidays).
MAX_FALLBACK_DAYS = 7


# Sub-unit currencies: not their own yfinance pair, but a fractional unit of a
# parent currency. yfinance returns 'GBp' for LSE pence quotes (1 GBP = 100 GBp);
# 'GBX' is an older alias for the same. We map them onto the canonical pair
# (GBP) and divide the rate by the divisor at lookup time.
SUBUNIT_CURRENCIES: dict[str, tuple[str, float]] = {
    "GBp": ("GBP", 100.0),
    "GBX": ("GBP", 100.0),
}


def _normalize_currency(currency: str) -> tuple[str, float]:
    """Return (canonical_currency, divisor). Identity for non-subunit currencies."""
    return SUBUNIT_CURRENCIES.get(currency, (currency, 1.0))


class FxRateUnavailable(Exception):
    """Raised when no FX rate is available within the fallback window."""


# ── Reads ──


def get_rate_to_usd(db: Session, currency: str, on_date: date) -> float:
    """Most-recent rate at or before `on_date`.

    Returns 1.0 for USD. Sub-unit currencies (e.g., 'GBp') are normalized to
    their parent and the rate divided by the parent's sub-unit factor.
    Raises `FxRateUnavailable` if no rate within `MAX_FALLBACK_DAYS` — that's
    a signal the FX sync hasn't been run.
    """
    canonical, divisor = _normalize_currency(currency)
    if canonical == "USD":
        return 1.0 / divisor

    cutoff = on_date - timedelta(days=MAX_FALLBACK_DAYS)
    row = (
        db.query(FxRate)
        .filter(
            FxRate.currency == canonical,
            FxRate.date <= on_date,
            FxRate.date >= cutoff,
        )
        .order_by(FxRate.date.desc())
        .first()
    )
    if row is None:
        raise FxRateUnavailable(
            f"No FX rate for {canonical} on or before {on_date} within {MAX_FALLBACK_DAYS} days"
        )
    return row.rate_to_usd / divisor


def convert(
    db: Session,
    amount: float,
    from_ccy: str,
    to_ccy: str,
    on_date: date,
) -> float:
    """Convert `amount` from `from_ccy` to `to_ccy` using the rate at `on_date`."""
    if from_ccy == to_ccy:
        return amount
    from_rate = get_rate_to_usd(db, from_ccy, on_date)
    to_rate = get_rate_to_usd(db, to_ccy, on_date)
    return amount * from_rate / to_rate


# ── Writes / sync ──


def _yf_pair_symbol(currency: str) -> str:
    """yfinance symbol for the currency-vs-USD pair (e.g., 'EUR' → 'EURUSD=X')."""
    return f"{currency}USD=X"


def get_fx_bounds(db: Session, currency: str) -> tuple[date | None, date | None]:
    """Earliest and latest stored dates for a currency."""
    result = (
        db.query(func.min(FxRate.date), func.max(FxRate.date))
        .filter(FxRate.currency == currency)
        .first()
    )
    if result:
        return result[0], result[1]
    return None, None


def _store_pair(db: Session, currency: str, df: pd.DataFrame) -> int:
    """Upsert a yfinance OHLCV frame as `(currency, date, rate_to_usd=close)` rows."""
    if df.empty:
        return 0

    rows = []
    for idx, row in df.iterrows():
        rate_date = idx.date() if hasattr(idx, "date") else idx
        close = row.get("Close")
        if close is None or pd.isna(close):
            continue
        rows.append(
            {
                "currency": currency,
                "date": rate_date,
                "rate_to_usd": float(close),
            }
        )
    if not rows:
        return 0

    stmt = pg_insert(FxRate).values(rows)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_fx_rates_currency_date",
        set_={"rate_to_usd": stmt.excluded.rate_to_usd},
    )
    db.execute(stmt)
    db.commit()
    return len(rows)


def _fetch_pair_from_yfinance(
    db: Session, currency: str, start_date: date, end_date: date
) -> int:
    """Fetch the `<currency>USD=X` series from yfinance and upsert into fx_rates."""
    df = fetch_from_yfinance(_yf_pair_symbol(currency), start_date, end_date)
    return _store_pair(db, currency, df)


def sync_fx_pair(db: Session, currency: str, start_date: date) -> dict:
    """Gap-fill mirror of `market_data_service.sync_ticker` for one currency.

    USD is a no-op (the anchor — rate always 1.0). Sub-unit currencies (e.g.
    'GBp') are normalized to their parent — we sync 'GBP' once and let
    `get_rate_to_usd` apply the divisor at lookup time.
    """
    canonical, _ = _normalize_currency(currency)
    if canonical == "USD":
        return {"fetched": 0, "skipped": True}

    today = date.today()
    last_trading_day = get_last_trading_day(today)
    earliest, latest = get_fx_bounds(db, canonical)
    fetched = 0

    if earliest is None or latest is None:
        fetched = _fetch_pair_from_yfinance(db, canonical, start_date, today)
    else:
        first_expected_trading_day = get_next_trading_day(start_date)
        if earliest > first_expected_trading_day:
            backward_end = earliest - timedelta(days=1)
            fetched += _fetch_pair_from_yfinance(db, canonical, start_date, backward_end)

        if latest < last_trading_day:
            forward_start = latest + timedelta(days=1)
            fetched += _fetch_pair_from_yfinance(db, canonical, forward_start, today)

    return {"fetched": fetched, "skipped": fetched == 0}


def sync_fx_all(
    db: Session, currencies: list[str], start_date: date
) -> dict:
    """Run `sync_fx_pair` per currency. Mirrors `market_data_service.sync_all`."""
    results: dict[str, int] = {}
    errors: dict[str, str] = {}
    skipped: list[str] = []
    total_rows = 0

    for currency in currencies:
        if currency == "USD":
            skipped.append(currency)
            continue
        try:
            result = sync_fx_pair(db, currency, start_date)
            results[currency] = result["fetched"]
            total_rows += result["fetched"]
            if result["skipped"]:
                skipped.append(currency)
        except Exception as exc:
            errors[currency] = str(exc)
            results[currency] = 0

    return {
        "results": results,
        "total_rows": total_rows,
        "skipped": skipped,
        "errors": errors,
    }


def ensure_rates_for(
    db: Session, currencies: list[str], since_date: date
) -> dict:
    """Convenience wrapper: ensure history exists for every currency back to `since_date`."""
    return sync_fx_all(db, currencies, since_date)


# Default lookback when a user has no events / trades on file yet.
DEFAULT_LOOKBACK_DAYS = 365


def ensure_rates_for_user(db: Session, user_id: int) -> dict:
    """Sync FX history covering every currency this user has events or trades in.

    Idempotent: gap detection inside `sync_fx_pair` short-circuits when the
    history is already complete. Intended to be called as a best-effort side
    effect on read endpoints (e.g. /api/fund/events) so users never have to
    manually trigger an initial FX sync.

    The since_date is the earliest date this user has financial data for —
    the min of fund_events.event_date and trades.date_planned. If no data
    exists yet, falls back to today − DEFAULT_LOOKBACK_DAYS.
    """
    from sqlalchemy import func

    from asistrader.models.db import (
        FundEvent,
        Ticker,
        Trade,
        UserFundSettings,
    )

    # User's currencies = distinct ticker currencies on their trades + base.
    ticker_currency_rows = (
        db.query(Ticker.currency)
        .join(Trade, Trade.ticker == Ticker.symbol)
        .filter(Trade.user_id == user_id, Ticker.currency.isnot(None))
        .distinct()
        .all()
    )
    currencies: set[str] = {row[0] for row in ticker_currency_rows if row[0]}

    settings = (
        db.query(UserFundSettings)
        .filter(UserFundSettings.user_id == user_id)
        .first()
    )
    base = settings.base_currency if settings and settings.base_currency else "USD"
    currencies.add(base)

    # Oldest date we need rates for.
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
    since_date = (
        min(candidates)
        if candidates
        else date.today() - timedelta(days=DEFAULT_LOOKBACK_DAYS)
    )

    return sync_fx_all(db, sorted(currencies), since_date)
