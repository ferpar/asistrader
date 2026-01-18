"""Market data service for fetching and managing OHLCV data."""

from datetime import date

import pandas as pd
import yfinance as yf
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from asistrader.models.db import MarketData, Ticker


def fetch_from_yfinance(symbol: str, start_date: date, end_date: date) -> pd.DataFrame:
    """Fetch OHLCV data from yfinance.

    Args:
        symbol: Ticker symbol (e.g., 'ASML')
        start_date: Start date for data range
        end_date: End date for data range (inclusive)

    Returns:
        DataFrame with columns: Open, High, Low, Close, Volume
        Index is DatetimeIndex
    """
    ticker = yf.Ticker(symbol)
    # yfinance end is exclusive, so add 1 day
    end_date_exclusive = end_date + pd.Timedelta(days=1)
    df = ticker.history(start=start_date, end=end_date_exclusive)
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


def store_market_data(db: Session, symbol: str, df: pd.DataFrame) -> int:
    """Store market data using upsert logic.

    Args:
        db: Database session
        symbol: Ticker symbol
        df: DataFrame from yfinance with OHLCV data

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
            "volume": stmt.excluded.volume,
        },
    )
    db.execute(stmt)
    db.commit()

    return len(rows)


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
            return fetch_and_store(db, symbol, start.date() if hasattr(start, "date") else start, target_date)
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
