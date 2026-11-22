"""Market data service for fetching and managing OHLCV data."""

import logging
import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pandas as pd
import yfinance as yf
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from asistrader.models.db import MarketData, Ticker, TickerSplit
from asistrader.services.ticker_service import (
    TickerValidationError,
    backfill_ticker_metadata,
    validate_ticker_with_yfinance,
)

logger = logging.getLogger(__name__)


# ── Force-refresh bulk path ──
#
# Force-refresh re-fetches every ticker's full history. With ~130 tickers a
# serial loop would fire 130 sequential yfinance calls and Yahoo throttles
# around ~50 in quick succession. Instead we batch via `yf.download(tickers=...)`
# which fetches a chunk concurrently in one call, then pause briefly before
# the next chunk so we stay well below the rate limit.
BULK_HISTORY_CHUNK_SIZE = 20
BULK_HISTORY_CHUNK_DELAY_SECONDS = 2.0
# A chunk covers BULK_HISTORY_CHUNK_SIZE symbols of full history, so allow more
# headroom than a spot-price fetch — but still bound it.
BULK_HISTORY_TIMEOUT_SECONDS = 60


# ── Un-fillable backward gaps ──
#
# Yahoo simply has no history before a given date for some listings (recent
# IPOs, re-listings, venue-specific tickers). Gap detection asks for that
# missing range, gets nothing, stores nothing — and asks again on the very next
# sync. Production logs showed ~6.3k such fetches from nine symbols, every one
# of them guaranteed to return empty, each holding a worker thread and a pooled
# DB connection while it waited on the network.
#
# So we remember the dead end. A backfill that returns zero rows stamps
# `Ticker.backfill_exhausted_at`; later syncs skip the backward fetch until the
# stamp ages past BACKFILL_RETRY_DAYS, which bounds the cost of a genuinely
# extended history to one probe a month instead of one per sync.
BACKFILL_RETRY_DAYS = 30


def _backfill_is_exhausted(ticker: Ticker | None, now: datetime | None = None) -> bool:
    """True when a recent backward fetch for this ticker came back empty."""
    if ticker is None or ticker.backfill_exhausted_at is None:
        return False
    now = now or datetime.now(timezone.utc)
    stamp = ticker.backfill_exhausted_at
    # Column is naive; treat a naive stamp as UTC so the comparison is valid
    # regardless of how it was written.
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return now - stamp < timedelta(days=BACKFILL_RETRY_DAYS)


def _record_backfill_result(db: Session, symbol: str, fetched: int) -> None:
    """Stamp (or clear) the exhausted marker after a backward fetch attempt."""
    ticker = db.query(Ticker).filter(Ticker.symbol == symbol).first()
    if ticker is None:
        return
    ticker.backfill_exhausted_at = (
        None if fetched > 0 else datetime.now(timezone.utc).replace(tzinfo=None)
    )
    db.commit()


def get_last_trading_day(reference_date: date) -> date:
    """Get the expected last trading day based on the day of week.

    Accounts for weekends but not holidays.

    Args:
        reference_date: The reference date

    Returns:
        The expected last trading day
    """
    weekday = reference_date.weekday()
    if weekday == 0:  # Monday
        return reference_date - timedelta(days=3)  # Friday
    elif weekday == 6:  # Sunday
        return reference_date - timedelta(days=2)  # Friday
    else:  # Tuesday-Saturday
        return reference_date - timedelta(days=1)  # Previous day


def get_next_trading_day(reference_date: date) -> date:
    """Get the expected next trading day based on the day of week.

    Accounts for weekends but not holidays.

    Args:
        reference_date: The reference date

    Returns:
        The expected next trading day
    """
    weekday = reference_date.weekday()
    if weekday == 4:  # Friday
        return reference_date + timedelta(days=3)  # Monday
    elif weekday == 5:  # Saturday
        return reference_date + timedelta(days=2)  # Monday
    else:  # Sunday-Thursday
        return reference_date + timedelta(days=1)  # Next day


def fetch_from_yfinance(symbol: str, start_date: date, end_date: date) -> pd.DataFrame:
    """Fetch OHLCV data from yfinance.

    Args:
        symbol: Ticker symbol (e.g., 'ASML')
        start_date: Start date for data range
        end_date: End date for data range (inclusive)

    Returns:
        DataFrame with columns: Open, High, Low, Close, Adj Close, Volume,
        Dividends, Stock Splits. Index is DatetimeIndex

    Note:
        We pass `auto_adjust=False` so the OHLC values are not back-adjusted
        for dividends. yfinance's default (`True`) does that, which silently
        lowers historical lows below the user's entry/SL levels and causes
        false-positive auto-detect hits. Yahoo still adjusts these prices for
        splits (ADR 0002); split events come in "Stock Splits" and are stored
        by `store_market_data` so Portfolios can apply them. Yahoo restates
        earlier bars on every new split or dividend, so the sync re-fetches the
        stored range when one arrives (see `_fetch_and_store_forward`).
    """
    ticker = yf.Ticker(symbol)
    # yfinance end is exclusive, so add 1 day
    end_date_exclusive = end_date + pd.Timedelta(days=1)
    df = ticker.history(
        start=start_date,
        end=end_date_exclusive,
        auto_adjust=False,
    )
    return df


def ensure_ticker_exists(db: Session, symbol: str) -> Ticker:
    """Ensure a ticker exists in the database, creating it if needed.

    Args:
        db: Database session
        symbol: Ticker symbol

    Returns:
        The Ticker object
    """
    ticker = db.query(Ticker).filter(Ticker.symbol == symbol).first()
    if not ticker:
        ticker = Ticker(symbol=symbol)
        db.add(ticker)
        db.commit()
        db.refresh(ticker)
    return ticker


def _optional_float(value: object) -> float | None:
    """A float, or None for a missing/NaN cell (e.g. a frame without Adj Close)."""
    if value is None or pd.isna(value):
        return None
    return float(value)


def store_market_data(db: Session, symbol: str, df: pd.DataFrame) -> int:
    """Store market data using upsert logic.

    Args:
        db: Database session
        symbol: Ticker symbol
        df: DataFrame from yfinance with OHLCV data, plus "Adj Close" when
            available (stored as `adj_close`; left null if the column is absent)

    Returns:
        Number of rows upserted
    """
    if df.empty:
        return 0

    rows = []
    for idx, row in df.iterrows():
        data_date = idx.date() if hasattr(idx, "date") else idx
        rows.append(
            {
                "ticker": symbol,
                "date": data_date,
                "open": float(row["Open"]) if pd.notna(row["Open"]) else None,
                "high": float(row["High"]) if pd.notna(row["High"]) else None,
                "low": float(row["Low"]) if pd.notna(row["Low"]) else None,
                "close": float(row["Close"]) if pd.notna(row["Close"]) else None,
                "adj_close": _optional_float(row.get("Adj Close")),
                "volume": float(row["Volume"]) if pd.notna(row["Volume"]) else None,
            }
        )

    if not rows:
        return 0

    # Use PostgreSQL upsert (ON CONFLICT DO UPDATE)
    stmt = pg_insert(MarketData).values(rows)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_market_data_ticker_date",
        set_={
            "open": stmt.excluded.open,
            "high": stmt.excluded.high,
            "low": stmt.excluded.low,
            "close": stmt.excluded.close,
            "adj_close": stmt.excluded.adj_close,
            "volume": stmt.excluded.volume,
        },
    )
    db.execute(stmt)
    store_splits(db, symbol, df)
    db.commit()

    return len(rows)


def store_splits(db: Session, symbol: str, df: pd.DataFrame) -> int:
    """Upsert the split events in a yfinance frame's "Stock Splits" column
    (the ratio on the split date, 0 elsewhere). A frame without the column
    (e.g. a bulk download without actions) stores nothing. Not committed.

    Returns:
        Number of split events upserted
    """
    if df.empty or "Stock Splits" not in df.columns:
        return 0
    stored = 0
    for idx, ratio in df["Stock Splits"].items():
        if pd.isna(ratio) or float(ratio) <= 0:
            continue
        day = idx.date() if hasattr(idx, "date") else idx
        value = Decimal(str(float(ratio)))
        existing = (
            db.query(TickerSplit)
            .filter(TickerSplit.ticker == symbol, TickerSplit.date == day)
            .first()
        )
        if existing is None:
            db.add(TickerSplit(ticker=symbol, date=day, ratio=value))
        else:
            existing.ratio = value
        stored += 1
    return stored


def _brings_new_corporate_action(db: Session, symbol: str, df: pd.DataFrame) -> bool:
    """True if a fetched frame has a dividend, or a split not yet stored.

    Missing "Dividends"/"Stock Splits" columns count as no event.
    """
    if df.empty:
        return False
    if "Dividends" in df.columns and (df["Dividends"].fillna(0) > 0).any():
        return True
    if "Stock Splits" not in df.columns:
        return False
    for idx, ratio in df["Stock Splits"].items():
        if pd.isna(ratio) or float(ratio) <= 0:
            continue
        day = idx.date() if hasattr(idx, "date") else idx
        stored = (
            db.query(TickerSplit.ratio)
            .filter(TickerSplit.ticker == symbol, TickerSplit.date == day)
            .scalar()
        )
        if stored is None or float(stored) != float(ratio):
            return True
    return False


def _fetch_and_store_forward(
    db: Session, symbol: str, earliest: date, start_date: date, end_date: date
) -> int:
    """Fill the forward gap from `start_date`, keeping the series in one basis.

    Yahoo restates every earlier bar when a split or dividend happens: `Close`
    (and open/high/low) by the split ratio, `Adj Close` by splits and
    dividends. Gap filling alone would leave the stored rows in the old basis
    next to new rows in the new one (a fake jump in raw closes, Portfolio
    Value and indexes). So when the new bars bring a split not yet in
    `ticker_splits` or a dividend, the whole stored range (`earliest` on) is
    re-fetched and overwritten, keeping the stored series fully restated to
    the latest basis (ADR 0002). Syncs without a new event fetch the gap only.

    Known limitation, out of scope: a Trade spanning a split compares its
    exit-level prices (entered in pre-split terms) against restated highs and
    lows after the re-fetch.

    Returns:
        Number of new-gap rows stored
    """
    ensure_ticker_exists(db, symbol)
    df = fetch_from_yfinance(symbol, start_date, end_date)
    restate = _brings_new_corporate_action(db, symbol, df)
    stored = store_market_data(db, symbol, df)
    if restate:
        store_market_data(db, symbol, fetch_from_yfinance(symbol, earliest, end_date))
    return stored


def fetch_splits_from_yfinance(symbol: str) -> pd.Series:
    """Every split event Yahoo knows for the symbol: ratio indexed by date."""
    return yf.Ticker(symbol).splits


def backfill_splits(db: Session, symbols: list[str] | None = None) -> dict:
    """Store the split events of existing tickers.

    Sync stores the splits found in the bars it fetches, so tickers whose
    history was loaded before splits were recorded need this one-off pass
    (see `asistrader.cli.backfill_instrument_metadata`). Rerunning is safe:
    events are upserted by (ticker, date).

    Returns:
        Dict with 'results' (symbol -> split events stored) and 'errors'
        (symbol -> message).
    """
    if symbols is None:
        symbols = get_all_ticker_symbols(db)
    results: dict[str, int] = {}
    errors: dict[str, str] = {}
    for symbol in symbols:
        try:
            splits = fetch_splits_from_yfinance(symbol)
            frame = pd.DataFrame({"Stock Splits": splits})
            results[symbol] = store_splits(db, symbol, frame)
            db.commit()
        except Exception as e:
            db.rollback()
            errors[symbol] = str(e) or type(e).__name__
    return {"results": results, "errors": errors}


def get_market_data(
    db: Session, symbol: str, start_date: date | None = None, end_date: date | None = None
) -> list[MarketData]:
    """Query stored market data with optional date filters.

    Args:
        db: Database session
        symbol: Ticker symbol
        start_date: Optional start date filter
        end_date: Optional end date filter

    Returns:
        List of MarketData objects ordered by date
    """
    query = db.query(MarketData).filter(MarketData.ticker == symbol)

    if start_date:
        query = query.filter(MarketData.date >= start_date)
    if end_date:
        query = query.filter(MarketData.date <= end_date)

    return query.order_by(MarketData.date).all()


def get_bulk_closes(
    db: Session, symbols: list[str], start_date: date
) -> dict[str, tuple[list[date], list[float], list[float | None]]]:
    """Stored closes for many tickers from `start_date`, as (dates, closes, adj_closes).

    Serves the radar, which reads every ticker at once and only uses the
    closes. One query for all symbols over just those columns, gathered into
    parallel lists per symbol instead of one object per row — the per-row
    path was the backend's heaviest request (~100MB peak, see
    scripts/profile_memory.py). Rows without a close are skipped; symbols
    without data map to empty lists. The adjusted close is None on rows not
    yet backfilled.
    """
    rows = db.execute(
        select(MarketData.ticker, MarketData.date, MarketData.close, MarketData.adj_close)
        .where(
            MarketData.ticker.in_(symbols),
            MarketData.date >= start_date,
            MarketData.close.isnot(None),
        )
        .order_by(MarketData.ticker, MarketData.date)
    )
    out: dict[str, tuple[list[date], list[float], list[float | None]]] = {
        symbol: ([], [], []) for symbol in symbols
    }
    for ticker, day, close, adj_close in rows:
        dates, closes, adj_closes = out[ticker]
        dates.append(day)
        closes.append(close)
        adj_closes.append(adj_close)
    return out


def get_data_bounds(db: Session, symbol: str) -> tuple[date | None, date | None]:
    """Get earliest and latest dates for a ticker.

    Args:
        db: Database session
        symbol: Ticker symbol

    Returns:
        Tuple of (earliest_date, latest_date), both may be None if no data
    """
    result = db.query(
        func.min(MarketData.date), func.max(MarketData.date)
    ).filter(MarketData.ticker == symbol).first()

    if result:
        return result[0], result[1]
    return None, None


def fetch_and_store(db: Session, symbol: str, start_date: date, end_date: date) -> int:
    """Fetch from yfinance and store in database.

    Args:
        db: Database session
        symbol: Ticker symbol
        start_date: Start date for data range
        end_date: End date for data range

    Returns:
        Number of rows stored
    """
    ensure_ticker_exists(db, symbol)
    df = fetch_from_yfinance(symbol, start_date, end_date)
    return store_market_data(db, symbol, df)


def extend_series(db: Session, symbol: str, direction: str, target_date: date) -> int:
    """Fetch and store missing data to extend the series.

    Args:
        db: Database session
        symbol: Ticker symbol
        direction: 'forward' or 'backward'
        target_date: Date to extend to

    Returns:
        Number of new rows added
    """
    earliest, latest = get_data_bounds(db, symbol)

    if direction == "forward":
        if latest is None:
            # No data yet, fetch from target_date backwards 1 year
            start = date(target_date.year - 1, target_date.month, target_date.day)
            return fetch_and_store(db, symbol, start, target_date)
        elif target_date > latest:
            # Fetch from day after latest to target
            start = latest + pd.Timedelta(days=1)
            start_date = start.date() if hasattr(start, "date") else start
            return _fetch_and_store_forward(db, symbol, earliest, start_date, target_date)
    elif direction == "backward":
        if earliest is None:
            # No data yet, fetch from target_date to today
            return fetch_and_store(db, symbol, target_date, date.today())
        elif target_date < earliest:
            # Fetch from target to day before earliest
            end = earliest - pd.Timedelta(days=1)
            return fetch_and_store(db, symbol, target_date, end.date() if hasattr(end, "date") else end)

    return 0


def get_all_ticker_symbols(db: Session) -> list[str]:
    """Get all ticker symbols from the database.

    Args:
        db: Database session

    Returns:
        List of ticker symbols
    """
    result = db.query(Ticker.symbol).all()
    return [r[0] for r in result]


def bulk_fetch(
    db: Session, start_date: date, end_date: date, symbols: list[str] | None = None
) -> dict:
    """Fetch market data for multiple tickers.

    Args:
        db: Database session
        start_date: Start date for data range
        end_date: End date for data range
        symbols: List of ticker symbols, or None for all tickers in db

    Returns:
        Dict with 'results' (symbol -> row count), 'total_rows', and 'errors'
    """
    if symbols is None:
        symbols = get_all_ticker_symbols(db)

    results = {}
    errors = {}
    total_rows = 0

    for symbol in symbols:
        try:
            count = fetch_and_store(db, symbol, start_date, end_date)
            results[symbol] = count
            total_rows += count
        except Exception as e:
            errors[symbol] = str(e)
            results[symbol] = 0

    return {"results": results, "total_rows": total_rows, "errors": errors}


def bulk_extend(
    db: Session, direction: str, target_date: date, symbols: list[str] | None = None
) -> dict:
    """Extend data series for multiple tickers.

    Args:
        db: Database session
        direction: 'forward' or 'backward'
        target_date: Date to extend to
        symbols: List of ticker symbols, or None for all tickers in db

    Returns:
        Dict with 'results' (symbol -> row count), 'total_rows', and 'errors'
    """
    if symbols is None:
        symbols = get_all_ticker_symbols(db)

    results = {}
    errors = {}
    total_rows = 0

    for symbol in symbols:
        try:
            count = extend_series(db, symbol, direction, target_date)
            results[symbol] = count
            total_rows += count
        except Exception as e:
            errors[symbol] = str(e)
            results[symbol] = 0

    return {"results": results, "total_rows": total_rows, "errors": errors}


def fetch_bulk_from_yfinance(
    symbols: list[str],
    start_date: date,
    end_date: date,
) -> dict[str, pd.DataFrame]:
    """Fetch OHLCV history for multiple symbols in a single yfinance call.

    Returns a dict `{symbol → per-symbol DataFrame}`. Symbols missing from
    yfinance's response (delisted, typos) are simply absent from the result.
    """
    if not symbols:
        return {}

    end_exclusive = end_date + pd.Timedelta(days=1)
    df = yf.download(
        tickers=symbols,
        start=start_date,
        end=end_exclusive,
        auto_adjust=False,
        actions=True,
        progress=False,
        group_by="ticker",
        threads=True,
        timeout=BULK_HISTORY_TIMEOUT_SECONDS,
    )

    if df is None or df.empty:
        return {}

    out: dict[str, pd.DataFrame] = {}
    if len(symbols) == 1:
        # Flat OHLCV frame for a single symbol.
        out[symbols[0]] = df
        return out

    # Multi-symbol → MultiIndex columns keyed by symbol on the outer level.
    available = set(df.columns.get_level_values(0))
    for sym in symbols:
        if sym not in available:
            continue
        sub = df[sym]
        # Action columns (Dividends, Stock Splits) are 0 on days the symbol
        # didn't trade, so drop by the price columns only.
        prices = [c for c in ("Open", "High", "Low", "Close") if c in sub.columns]
        sub = sub.dropna(how="all", subset=prices or None)
        if not sub.empty:
            out[sym] = sub
    return out


def bulk_fetch_and_store(
    db: Session,
    symbols: list[str],
    start_date: date,
    end_date: date,
    chunk_size: int = BULK_HISTORY_CHUNK_SIZE,
    delay_between_chunks: float = BULK_HISTORY_CHUNK_DELAY_SECONDS,
) -> dict[str, int]:
    """Bulk-fetch multiple tickers' history in chunks, with cool-off between.

    Used by force-refresh to stay under yfinance's rate limit. Each chunk is
    one HTTP burst (yfinance fires the chunk symbols in parallel internally),
    then a short sleep before the next chunk so we don't trip throttling.
    Returns `{symbol → rows stored}` (zero for symbols absent from the fetch).
    """
    upper_symbols = [s.upper() for s in symbols]
    counts: dict[str, int] = {sym: 0 for sym in upper_symbols}
    if not upper_symbols:
        return counts

    for i in range(0, len(upper_symbols), chunk_size):
        chunk = upper_symbols[i : i + chunk_size]
        fetched = fetch_bulk_from_yfinance(chunk, start_date, end_date)
        for sym, sub in fetched.items():
            ensure_ticker_exists(db, sym)
            stored = store_market_data(db, sym, sub)
            counts[sym] = stored
        # Cool-off between chunks (skip after the last chunk).
        if i + chunk_size < len(upper_symbols):
            time.sleep(delay_between_chunks)

    return counts


def backfill_adjusted_closes(db: Session, symbols: list[str] | None = None) -> dict:
    """Fill `adj_close` on rows stored before adjusted closes were recorded.

    Regular sync only fetches date gaps, so rows that already exist would
    never get an adjusted close. This targets them explicitly: for each
    ticker with rows whose adj_close is NULL, refetch that date span from
    yfinance and upsert it. Tickers with complete adjusted closes are not
    fetched, so running it again is cheap. Meant as a one-off after the
    column was added (see `asistrader.cli.backfill_adj_close`).

    Returns:
        Dict with 'results' (symbol -> rows upserted), 'total_rows' and
        'errors' (symbol -> message).
    """
    query = (
        select(MarketData.ticker, func.min(MarketData.date), func.max(MarketData.date))
        .where(MarketData.adj_close.is_(None), MarketData.close.isnot(None))
        .group_by(MarketData.ticker)
        .order_by(MarketData.ticker)
    )
    if symbols is not None:
        query = query.where(MarketData.ticker.in_(symbols))
    spans = db.execute(query).all()

    results: dict[str, int] = {}
    errors: dict[str, str] = {}
    for symbol, start, end in spans:
        try:
            results[symbol] = store_market_data(db, symbol, fetch_from_yfinance(symbol, start, end))
        except Exception as e:
            db.rollback()
            errors[symbol] = str(e)
    return {"results": results, "total_rows": sum(results.values()), "errors": errors}


def sync_ticker(
    db: Session,
    symbol: str,
    start_date: date,
    force_refresh: bool = False,
) -> dict:
    """Sync single ticker from start_date to today.

    Intelligently fetches only missing data:
    - If no data: fetch from start_date to today
    - If has data but earliest > start_date: fetch start_date to earliest-1
    - If has data but latest < today: fetch latest+1 to today
    - Skip if data already covers start_date to today

    Args:
        db: Database session
        symbol: Ticker symbol
        start_date: Start date for sync range
        force_refresh: If True, wipe existing rows and re-fetch the full range.
            Use when previously-stored data needs to be replaced (e.g., after
            switching from `auto_adjust=True` to `auto_adjust=False`).

    Returns:
        Dict with 'fetched' (int) and 'skipped' (bool)
    """
    today = date.today()

    if force_refresh:
        db.query(MarketData).filter(MarketData.ticker == symbol).delete()
        # A forced re-fetch re-establishes the bounds from scratch, so whatever
        # we previously learned about the backward limit no longer applies.
        db.query(Ticker).filter(Ticker.symbol == symbol).update(
            {Ticker.backfill_exhausted_at: None}
        )
        db.commit()
        fetched = fetch_and_store(db, symbol, start_date, today)
        return {"fetched": fetched, "skipped": fetched == 0}

    last_trading_day = get_last_trading_day(today)
    earliest, latest = get_data_bounds(db, symbol)
    fetched = 0

    if earliest is None or latest is None:
        # No data at all - fetch everything
        fetched = fetch_and_store(db, symbol, start_date, today)
    else:
        # Check for backward gap (need older data)
        # Use next trading day from start_date to avoid fetching holidays/weekends
        first_expected_trading_day = get_next_trading_day(start_date)
        ticker = db.query(Ticker).filter(Ticker.symbol == symbol).first()
        if earliest > first_expected_trading_day and not _backfill_is_exhausted(ticker):
            backward_end = earliest - pd.Timedelta(days=1)
            backward_end_date = backward_end.date() if hasattr(backward_end, "date") else backward_end
            backfilled = fetch_and_store(db, symbol, start_date, backward_end_date)
            fetched += backfilled
            # An empty result means the history doesn't go back that far —
            # remember it so the next sync doesn't ask all over again.
            _record_backfill_result(db, symbol, backfilled)

        # Check for forward gap (need newer data)
        # Use last_trading_day to avoid refetching on weekends
        if latest < last_trading_day:
            forward_start = latest + pd.Timedelta(days=1)
            forward_start_date = forward_start.date() if hasattr(forward_start, "date") else forward_start
            # The backward fill above may have moved the earliest stored day.
            earliest, _ = get_data_bounds(db, symbol)
            fetched += _fetch_and_store_forward(db, symbol, earliest, forward_start_date, today)

    skipped = fetched == 0
    return {"fetched": fetched, "skipped": skipped}


def ensure_ticker_with_history(db: Session, symbol: str, since: date) -> Ticker:
    """Return the ticker, creating it and loading its history if it's unknown.

    An unknown symbol is validated against yfinance (raising
    `TickerValidationError` when Yahoo doesn't know it either), stored with
    its name/currency/price hint, and its market data synced from `since`.
    A failed history load doesn't undo the creation: the regular syncs fill
    the gap later. A known ticker missing its currency gets its metadata
    backfilled, since prices can't be converted without it.
    """
    ticker = db.query(Ticker).filter(Ticker.symbol == symbol).first()
    if ticker is not None:
        if ticker.currency is None:
            backfill_ticker_metadata(db, ticker)
        return ticker

    validation = validate_ticker_with_yfinance(symbol)
    if not validation["valid"]:
        raise TickerValidationError(f"Unknown ticker symbol: {symbol}")
    ticker = Ticker(
        symbol=symbol,
        name=validation["name"],
        currency=validation["currency"],
        price_hint=validation["price_hint"],
        instrument_type=validation["instrument_type"],
        listing_country=validation["listing_country"],
    )
    db.add(ticker)
    db.commit()
    db.refresh(ticker)
    try:
        sync_ticker(db, symbol, since)
    except Exception:
        logger.exception("Failed to load history for new ticker %s", symbol)
    return ticker


def sync_all(
    db: Session,
    start_date: date,
    symbols: list[str] | None = None,
    force_refresh: bool = False,
) -> dict:
    """Sync all tickers from start_date to today.

    Intelligently fetches only missing data for each ticker.

    Args:
        db: Database session
        start_date: Start date for sync range
        symbols: List of ticker symbols, or None for all tickers in db
        force_refresh: If True, wipe and re-fetch every symbol. Used to replace
            stale data (e.g., after switching `auto_adjust` semantics).

    Returns:
        Dict with 'results' (symbol -> rows fetched), 'total_rows', 'skipped', and 'errors'
    """
    if symbols is None:
        symbols = get_all_ticker_symbols(db)

    results: dict[str, int] = {}
    errors: dict[str, str] = {}
    skipped: list[str] = []
    total_rows = 0

    if force_refresh:
        # One destructive sweep, one chunked bulk fetch — far fewer HTTP
        # bursts than calling sync_ticker per symbol, so we don't trip the
        # yfinance rate limit on portfolios with many tickers.
        try:
            for symbol in symbols:
                ticker = ensure_ticker_exists(db, symbol)
                backfill_ticker_metadata(db, ticker)
            db.query(MarketData).filter(MarketData.ticker.in_(symbols)).delete(
                synchronize_session=False
            )
            db.commit()

            today = date.today()
            counts = bulk_fetch_and_store(db, symbols, start_date, today)
            for symbol in symbols:
                fetched = counts.get(symbol.upper(), 0)
                results[symbol] = fetched
                total_rows += fetched
                if fetched == 0:
                    skipped.append(symbol)
        except Exception as e:
            # Surface a single top-level error rather than per-symbol — the
            # whole refresh either succeeded or it didn't.
            errors["__bulk__"] = str(e)
    else:
        for symbol in symbols:
            try:
                ticker = ensure_ticker_exists(db, symbol)
                backfill_ticker_metadata(db, ticker)
                result = sync_ticker(db, symbol, start_date, force_refresh=False)
                results[symbol] = result["fetched"]
                total_rows += result["fetched"]
                if result["skipped"]:
                    skipped.append(symbol)
            except Exception as e:
                errors[symbol] = str(e)
                results[symbol] = 0

    # Piggyback FX sync on ticker refresh: gather currencies of the synced
    # tickers and ensure their rate history is up to date. Local import to
    # avoid a service-layer circular dependency.
    from asistrader.services import fx_service

    currencies = sorted(
        {
            c
            for (c,) in db.query(Ticker.currency)
            .filter(Ticker.symbol.in_(symbols), Ticker.currency.isnot(None))
            .distinct()
            .all()
            if c
        }
    )
    fx_result: dict = {"results": {}, "total_rows": 0, "skipped": [], "errors": {}}
    if currencies:
        try:
            fx_result = fx_service.sync_fx_all(db, currencies, start_date)
        except Exception as e:
            fx_result["errors"]["__fx__"] = str(e)

    return {
        "results": results,
        "total_rows": total_rows,
        "skipped": skipped,
        "errors": errors,
        "fx": fx_result,
    }
