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
# Cap how long a single chunk may block. These calls run on a worker thread, so
# an unbounded one holds that thread until Yahoo answers or the socket dies.
PRICE_FETCH_TIMEOUT_SECONDS = 20

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


class TickerNotFoundError(Exception):
    """Raised when a ticker doesn't exist."""


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


# yfinance quoteType → our instrument type; other quoteTypes are lower-cased.
_QUOTE_TYPES = {"EQUITY": "stock", "ETF": "etf"}


def instrument_metadata(info: dict) -> dict:
    """Instrument type and listing country from a yfinance `.info` dict.

    The listing country is the venue's, read from `info["market"]`
    ("es_market" → "ES"). `info["country"]` is the company's domicile (ASML
    on Nasdaq says Netherlands) and must not be used. Either is None when
    Yahoo doesn't say.
    """
    quote_type = info.get("quoteType")
    instrument_type = _QUOTE_TYPES.get(quote_type, quote_type.lower()) if quote_type else None
    market = info.get("market") or ""
    prefix, _, suffix = market.partition("_")
    listing_country = (
        prefix.upper() if suffix == "market" and len(prefix) == 2 and prefix.isalpha() else None
    )
    return {"instrument_type": instrument_type, "listing_country": listing_country}


def validate_ticker_with_yfinance(symbol: str) -> dict:
    """Validate ticker exists via yfinance.

    Args:
        symbol: The ticker symbol to validate

    Returns:
        dict with 'name', 'currency', 'price_hint', 'instrument_type',
        'listing_country' and 'valid' keys
    """
    invalid = {
        "name": None,
        "currency": None,
        "price_hint": None,
        "instrument_type": None,
        "listing_country": None,
        "valid": False,
    }
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info
        # Check if we got valid data (yfinance returns empty dict for invalid tickers)
        if not info or info.get("quoteType") is None:
            return invalid
        name = info.get("shortName") or info.get("longName")
        return {
            "name": name,
            "currency": info.get("currency"),
            "price_hint": info.get("priceHint"),
            **instrument_metadata(info),
            "valid": True,
        }
    except Exception:
        logger.exception("Failed to validate ticker %s with yfinance", symbol)
        return invalid


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
        instrument_type=validation["instrument_type"],
        listing_country=validation["listing_country"],
    )
    db.add(ticker)
    db.commit()
    db.refresh(ticker)

    return ticker


def _fill_instrument_metadata(ticker: Ticker, info: dict) -> bool:
    """Set instrument type / listing country from `info` where still missing."""
    detected = instrument_metadata(info)
    updated = False
    for field in ("instrument_type", "listing_country"):
        if getattr(ticker, field) is None and detected[field] is not None:
            setattr(ticker, field, detected[field])
            updated = True
    return updated


def backfill_ticker_metadata(db: Session, ticker: Ticker) -> bool:
    """Fill missing currency/price_hint on an existing ticker from yfinance.

    Only looks Yahoo up when currency or price_hint is missing, so regular
    syncs don't call `.info` for every ticker forever; when it does, missing
    instrument type / listing country are filled too. Tickers that already
    have currency and price hint get those from
    `backfill_instrument_metadata` instead.

    Returns True if any field was updated, False if all were already populated
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

    updated = _fill_instrument_metadata(ticker, info)
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


def backfill_instrument_metadata(db: Session, symbols: list[str] | None = None) -> dict:
    """Fill instrument type and listing country on tickers created before they
    were recorded (or whose detection failed), from yfinance `.info`.

    Only tickers missing either field are looked up, so rerunning is cheap.
    Existing values are never overwritten. The login sync runs it per ticker
    through `market_data_service.repair_ticker_history`;
    `asistrader.cli.backfill_instrument_metadata` runs it by hand.

    Returns:
        Dict with 'results' (symbol -> {instrument_type, listing_country} after
        the backfill) and 'errors' (symbol -> message).
    """
    query = db.query(Ticker).filter(
        (Ticker.instrument_type.is_(None)) | (Ticker.listing_country.is_(None))
    )
    if symbols is not None:
        query = query.filter(Ticker.symbol.in_([s.upper().strip() for s in symbols]))
    tickers = query.order_by(Ticker.symbol).all()

    results: dict[str, dict] = {}
    errors: dict[str, str] = {}
    for ticker in tickers:
        try:
            info = yf.Ticker(ticker.symbol).info
        except Exception as e:
            logger.exception("Failed to backfill instrument metadata for %s", ticker.symbol)
            errors[ticker.symbol] = str(e) or type(e).__name__
            continue
        if not info or info.get("quoteType") is None:
            errors[ticker.symbol] = "Yahoo returned no metadata"
            continue
        _fill_instrument_metadata(ticker, info)
        db.commit()
        results[ticker.symbol] = {
            "instrument_type": ticker.instrument_type,
            "listing_country": ticker.listing_country,
        }
    return {"results": results, "errors": errors}


def set_asset_class_override(db: Session, symbol: str, asset_class: str | None) -> Ticker:
    """Set (or clear, with None) the ticker's global Asset Class override."""
    ticker = get_ticker_by_symbol(db, symbol.upper().strip())
    if ticker is None:
        raise TickerNotFoundError(f"Ticker {symbol} not found")
    ticker.asset_class_override = asset_class
    db.commit()
    db.refresh(ticker)
    return ticker


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
            timeout=PRICE_FETCH_TIMEOUT_SECONDS,
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
            # yfinance occasionally returns a sub-frame with no "Close" level
            # for thinly-traded or delisted symbols — skip rather than throw.
            if "Close" not in sub.columns:
                continue
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
        # Hand the pooled connection back before touching the network. The
        # yfinance calls below can run for tens of seconds, and holding a
        # connection across them is what exhausts the pool: enough concurrent
        # price requests and every other endpoint — including the auth
        # dependency behind /me and /login — blocks waiting for a connection
        # that is doing nothing but sitting on an HTTP round-trip.
        # `currencies` is already materialised into plain values, so nothing
        # below needs the session.
        db.commit()

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
