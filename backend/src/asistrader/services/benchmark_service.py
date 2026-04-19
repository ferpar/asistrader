"""Benchmark service for fetching and managing non-tradable index OHLCV data."""

import logging
from datetime import date

import pandas as pd
import yfinance as yf
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from asistrader.models.db import Benchmark, BenchmarkMarketData
from asistrader.services.market_data_service import (
    fetch_from_yfinance,
    get_last_trading_day,
    get_next_trading_day,
)

logger = logging.getLogger(__name__)


class BenchmarkExistsError(Exception):
    """Raised when trying to create a benchmark that already exists."""


class BenchmarkValidationError(Exception):
    """Raised when benchmark validation fails."""


def _fetch_benchmark_info(symbol: str) -> dict:
    """Fetch name/currency for an index symbol from yfinance.

    Returns a dict with 'name', 'currency', 'valid'.
    """
    try:
        info = yf.Ticker(symbol).info
    except Exception:
        logger.exception("Failed to fetch info for benchmark %s", symbol)
        return {"name": None, "currency": None, "valid": False}

    if not info or info.get("quoteType") is None:
        return {"name": None, "currency": None, "valid": False}

    return {
        "name": info.get("shortName") or info.get("longName"),
        "currency": info.get("currency"),
        "valid": True,
    }


def get_all_benchmarks(db: Session) -> list[Benchmark]:
    """Get all benchmarks ordered by symbol."""
    return db.query(Benchmark).order_by(Benchmark.symbol).all()


def get_benchmark_by_symbol(db: Session, symbol: str) -> Benchmark | None:
    """Get a single benchmark by symbol."""
    return db.query(Benchmark).filter(Benchmark.symbol == symbol).first()


def get_all_benchmark_symbols(db: Session) -> list[str]:
    """Return every benchmark symbol stored in the database."""
    return [row[0] for row in db.query(Benchmark.symbol).all()]


def create_benchmark(db: Session, symbol: str) -> Benchmark:
    """Validate via yfinance and create a new benchmark row.

    Raises BenchmarkExistsError if the symbol is already stored,
    BenchmarkValidationError if yfinance can't resolve the symbol.
    """
    symbol = symbol.upper().strip()

    if get_benchmark_by_symbol(db, symbol):
        raise BenchmarkExistsError(f"Benchmark {symbol} already exists")

    info = _fetch_benchmark_info(symbol)
    if not info["valid"]:
        raise BenchmarkValidationError(f"Invalid benchmark symbol: {symbol}")

    benchmark = Benchmark(
        symbol=symbol,
        name=info["name"],
        currency=info["currency"],
    )
    db.add(benchmark)
    db.commit()
    db.refresh(benchmark)
    return benchmark


def ensure_benchmark_exists(db: Session, symbol: str) -> Benchmark:
    """Ensure a benchmark row exists, creating a minimal one if missing."""
    benchmark = get_benchmark_by_symbol(db, symbol)
    if benchmark:
        return benchmark
    info = _fetch_benchmark_info(symbol)
    benchmark = Benchmark(
        symbol=symbol,
        name=info["name"],
        currency=info["currency"],
    )
    db.add(benchmark)
    db.commit()
    db.refresh(benchmark)
    return benchmark


def delete_benchmark(db: Session, symbol: str) -> bool:
    """Delete a benchmark (cascade removes its market data). Returns True on hit."""
    benchmark = get_benchmark_by_symbol(db, symbol)
    if not benchmark:
        return False
    db.delete(benchmark)
    db.commit()
    return True


def store_benchmark_market_data(db: Session, symbol: str, df: pd.DataFrame) -> int:
    """Upsert benchmark OHLCV rows. Mirrors market_data_service.store_market_data."""
    if df.empty:
        return 0

    rows = []
    for idx, row in df.iterrows():
        data_date = idx.date() if hasattr(idx, "date") else idx
        rows.append(
            {
                "benchmark": symbol,
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

    stmt = pg_insert(BenchmarkMarketData).values(rows)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_benchmark_market_data_benchmark_date",
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


def get_benchmark_market_data(
    db: Session,
    symbol: str,
    start_date: date | None = None,
    end_date: date | None = None,
) -> list[BenchmarkMarketData]:
    """Query stored benchmark OHLCV rows."""
    query = db.query(BenchmarkMarketData).filter(
        BenchmarkMarketData.benchmark == symbol
    )
    if start_date:
        query = query.filter(BenchmarkMarketData.date >= start_date)
    if end_date:
        query = query.filter(BenchmarkMarketData.date <= end_date)
    return query.order_by(BenchmarkMarketData.date).all()


def get_data_bounds(db: Session, symbol: str) -> tuple[date | None, date | None]:
    """Earliest and latest stored dates for a benchmark."""
    result = (
        db.query(func.min(BenchmarkMarketData.date), func.max(BenchmarkMarketData.date))
        .filter(BenchmarkMarketData.benchmark == symbol)
        .first()
    )
    if result:
        return result[0], result[1]
    return None, None


def fetch_and_store(db: Session, symbol: str, start_date: date, end_date: date) -> int:
    """Fetch from yfinance and upsert into benchmark_market_data."""
    ensure_benchmark_exists(db, symbol)
    df = fetch_from_yfinance(symbol, start_date, end_date)
    return store_benchmark_market_data(db, symbol, df)


def sync_benchmark(db: Session, symbol: str, start_date: date) -> dict:
    """Sync a single benchmark from start_date to today, only fetching gaps."""
    today = date.today()
    last_trading_day = get_last_trading_day(today)
    earliest, latest = get_data_bounds(db, symbol)
    fetched = 0

    if earliest is None or latest is None:
        fetched = fetch_and_store(db, symbol, start_date, today)
    else:
        first_expected_trading_day = get_next_trading_day(start_date)
        if earliest > first_expected_trading_day:
            backward_end = earliest - pd.Timedelta(days=1)
            backward_end_date = (
                backward_end.date() if hasattr(backward_end, "date") else backward_end
            )
            fetched += fetch_and_store(db, symbol, start_date, backward_end_date)

        if latest < last_trading_day:
            forward_start = latest + pd.Timedelta(days=1)
            forward_start_date = (
                forward_start.date() if hasattr(forward_start, "date") else forward_start
            )
            fetched += fetch_and_store(db, symbol, forward_start_date, today)

    return {"fetched": fetched, "skipped": fetched == 0}


def sync_all(db: Session, start_date: date, symbols: list[str] | None = None) -> dict:
    """Sync all benchmarks from start_date to today, filling only gaps."""
    if symbols is None:
        symbols = get_all_benchmark_symbols(db)

    results: dict[str, int] = {}
    errors: dict[str, str] = {}
    skipped: list[str] = []
    total_rows = 0

    for symbol in symbols:
        try:
            ensure_benchmark_exists(db, symbol)
            result = sync_benchmark(db, symbol, start_date)
            results[symbol] = result["fetched"]
            total_rows += result["fetched"]
            if result["skipped"]:
                skipped.append(symbol)
        except Exception as e:
            errors[symbol] = str(e)
            results[symbol] = 0

    return {
        "results": results,
        "total_rows": total_rows,
        "skipped": skipped,
        "errors": errors,
    }
