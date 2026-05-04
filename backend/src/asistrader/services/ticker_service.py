"""Ticker business logic service."""

import logging
import threading
import time

import yfinance as yf
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from asistrader.models.db import Ticker


# ── Batch-price scaling ──
#
# yfinance's `yf.download(symbols, threads=True)` is *parallel HTTP*, not a
# truly-batched URL call. With 50+ symbols Yahoo rate-limits aggressively, so
# we chunk the request and cache results briefly to keep navigation snappy.
PRICE_CHUNK_SIZE = 30
PRICE_CACHE_TTL_SECONDS = 60

_PRICE_CACHE: dict[str, tuple[float, dict]] = {}  # symbol → (expires_at, result)
_PRICE_CACHE_LOCK = threading.Lock()


def _cache_get(symbol: str) -> dict | None:
    with _PRICE_CACHE_LOCK:
        entry = _PRICE_CACHE.get(symbol)
        if entry is None:
            return None
        expires_at, result = entry
        if time.monotonic() >= expires_at:
            _PRICE_CACHE.pop(symbol, None)
            return None
        return result


def _cache_put(symbol: str, result: dict) -> None:
    with _PRICE_CACHE_LOCK:
        _PRICE_CACHE[symbol] = (
            time.monotonic() + PRICE_CACHE_TTL_SECONDS,
            result,
        )


def _clear_price_cache() -> None:
    """Test helper — wipe the in-process cache."""
    with _PRICE_CACHE_LOCK:
        _PRICE_CACHE.clear()


class TickerExistsError(Exception):
    """Raised when trying to create a ticker that already exists."""

    pass


class TickerValidationError(Exception):
    """Raised when ticker validation fails."""

    pass


def get_all_tickers(db: Session) -> list[Ticker]:
    """Get all tickers from the database ordered by symbol."""
    return db.query(Ticker).order_by(Ticker.symbol).all()


def get_ticker_by_symbol(db: Session, symbol: str) -> Ticker | None:
    """Get a single ticker by symbol."""
    return db.query(Ticker).filter(Ticker.symbol == symbol).first()


def get_existing_symbols(db: Session) -> set[str]:
    """Get set of existing ticker symbols for filtering search results."""
    tickers = db.query(Ticker.symbol).all()
    return {t.symbol for t in tickers}


def validate_ticker_with_yfinance(symbol: str) -> dict:
    """Validate ticker exists via yfinance.

    Args:
        symbol: The ticker symbol to validate

    Returns:
        dict with 'name', 'currency', 'price_hint', and 'valid' keys
    """
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info
        # Check if we got valid data (yfinance returns empty dict for invalid tickers)
        if not info or info.get("quoteType") is None:
            return {"name": None, "currency": None, "price_hint": None, "valid": False}
        name = info.get("shortName") or info.get("longName")
        return {
            "name": name,
            "currency": info.get("currency"),
            "price_hint": info.get("priceHint"),
            "valid": True,
        }
    except Exception:
        logger.exception("Failed to validate ticker %s with yfinance", symbol)
        return {"name": None, "currency": None, "price_hint": None, "valid": False}


def create_ticker(db: Session, symbol: str) -> Ticker:
    """Create new ticker after validation.

    Args:
        db: Database session
        symbol: The ticker symbol to create

    Returns:
        The created Ticker object

    Raises:
        TickerExistsError: If ticker already exists
        TickerValidationError: If ticker validation fails
    """
    symbol = symbol.upper().strip()

    # Check if ticker already exists
    existing = get_ticker_by_symbol(db, symbol)
    if existing:
        raise TickerExistsError(f"Ticker {symbol} already exists")

    # Validate with yfinance
    validation = validate_ticker_with_yfinance(symbol)
    if not validation["valid"]:
        raise TickerValidationError(f"Invalid ticker symbol: {symbol}")

    # Create the ticker
    ticker = Ticker(
        symbol=symbol,
        name=validation["name"],
        currency=validation["currency"],
        price_hint=validation["price_hint"],
    )
    db.add(ticker)
    db.commit()
    db.refresh(ticker)

    return ticker


def backfill_ticker_metadata(db: Session, ticker: Ticker) -> bool:
    """Fill missing currency/price_hint on an existing ticker from yfinance.

    Returns True if any field was updated, False if both were already populated
    or the yfinance lookup failed.
    """
    if ticker.currency is not None and ticker.price_hint is not None:
        return False

    try:
        info = yf.Ticker(ticker.symbol).info
    except Exception:
        logger.exception("Failed to backfill metadata for %s", ticker.symbol)
        return False

    if not info or info.get("quoteType") is None:
        return False

    updated = False
    if ticker.currency is None:
        currency = info.get("currency")
        if currency:
            ticker.currency = currency
            updated = True
    if ticker.price_hint is None:
        price_hint = info.get("priceHint")
        if price_hint is not None:
            ticker.price_hint = price_hint
            updated = True

    if updated:
        db.commit()
        db.refresh(ticker)
    return updated


def get_current_price(symbol: str) -> dict:
    """Get current price for a ticker via yfinance.

    Args:
        symbol: The ticker symbol

    Returns:
        dict with 'price', 'currency', and 'valid' keys
    """
    try:
        ticker = yf.Ticker(symbol)
        # Use fast_info for quicker price lookup
        fast_info = ticker.fast_info
        price = fast_info.get("lastPrice") or fast_info.get("regularMarketPrice")
        if price is None:
            return {"price": None, "currency": None, "valid": False}
        currency = fast_info.get("currency", "USD")
        return {"price": float(price), "currency": currency, "valid": True}
    except Exception:
        logger.exception("Failed to get current price for %s", symbol)
        return {"price": None, "currency": None, "valid": False}


def _fetch_chunk(
    symbols: list[str], currencies: dict[str, str | None]
) -> dict[str, dict]:
    """Fetch one chunk via yf.download. Returns per-symbol result dicts."""
    out: dict[str, dict] = {
        sym: {"price": None, "currency": None, "valid": False} for sym in symbols
    }
    try:
        df = yf.download(
            tickers=symbols,
            period="1d",
            progress=False,
            group_by="ticker",
            auto_adjust=False,
            threads=True,
        )
    except Exception:
        logger.exception("Batch yfinance download failed for %s", symbols)
        return out

    if df is None or df.empty:
        return out

    for sym in symbols:
        try:
            # >1 ticker → MultiIndex columns. =1 ticker → flat OHLCV.
            if len(symbols) > 1:
                if sym not in df.columns.get_level_values(0):
                    continue
                sub = df[sym]
            else:
                sub = df
            close_series = sub["Close"].dropna()
            if close_series.empty:
                continue
            last_price = float(close_series.iloc[-1])
            currency = currencies.get(sym)
            if currency is None:
                # Rare: ticker not in our DB. Pay one fast_info round-trip.
                try:
                    currency = yf.Ticker(sym).fast_info.get("currency")
                except Exception:
                    currency = None
            out[sym] = {"price": last_price, "currency": currency, "valid": True}
        except Exception:
            logger.exception("Failed to extract batch price for %s", sym)

    return out


def get_batch_prices(
    symbols: list[str], db: Session | None = None
) -> dict[str, dict]:
    """Get current prices for multiple tickers.

    Uses `yf.download(period="1d")` which is yfinance's parallel-fetch path
    (one HTTP request per symbol, but fired concurrently via threads). To
    avoid swamping Yahoo's rate limiter at scale, the symbol list is split
    into chunks of `PRICE_CHUNK_SIZE`, processed sequentially. Each result
    is cached for `PRICE_CACHE_TTL_SECONDS`, so a flurry of /prices calls
    during navigation only pays the network cost once.

    Currency is sourced from the local `tickers` table when `db` is provided
    (avoids a per-symbol metadata round-trip). For symbols not in the DB,
    falls back to fetching currency individually via fast_info.

    Returns dict mapping `symbol.upper()` to {price, currency, valid}.
    Symbols that don't appear in the yfinance response are returned with
    valid=False rather than dropped.
    """
    if not symbols:
        return {}

    upper_symbols = [s.upper() for s in symbols]
    results: dict[str, dict] = {}

    # Serve cached entries; collect the rest for fetching.
    to_fetch: list[str] = []
    for sym in upper_symbols:
        cached = _cache_get(sym)
        if cached is not None:
            results[sym] = cached
        else:
            to_fetch.append(sym)

    if not to_fetch:
        return results

    # Look up currencies once for the to-fetch set.
    currencies: dict[str, str | None] = {}
    if db is not None:
        rows = (
            db.query(Ticker.symbol, Ticker.currency)
            .filter(Ticker.symbol.in_(to_fetch))
            .all()
        )
        currencies = {sym: ccy for sym, ccy in rows}

    # Chunked fetches keep concurrent yfinance requests bounded.
    for start in range(0, len(to_fetch), PRICE_CHUNK_SIZE):
        chunk = to_fetch[start : start + PRICE_CHUNK_SIZE]
        chunk_result = _fetch_chunk(chunk, currencies)
        for sym, data in chunk_result.items():
            results[sym] = data
            if data["valid"]:
                # Only cache valid responses; invalid ones (e.g. transient
                # Yahoo errors) should be retried on the next call.
                _cache_put(sym, data)

    # Fill any remaining slots so the caller sees every requested symbol.
    for sym in upper_symbols:
        results.setdefault(
            sym, {"price": None, "currency": None, "valid": False}
        )

    return results
