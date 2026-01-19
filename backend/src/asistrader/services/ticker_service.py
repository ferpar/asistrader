"""Ticker business logic service."""

import yfinance as yf
from sqlalchemy.orm import Session

from asistrader.models.db import Ticker


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
        dict with 'name' and 'valid' keys
    """
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info
        # Check if we got valid data (yfinance returns empty dict for invalid tickers)
        if not info or info.get("quoteType") is None:
            return {"name": None, "valid": False}
        name = info.get("shortName") or info.get("longName")
        return {"name": name, "valid": True}
    except Exception:
        return {"name": None, "valid": False}


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
    ticker = Ticker(symbol=symbol, name=validation["name"])
    db.add(ticker)
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
        return {"price": None, "currency": None, "valid": False}


def get_batch_prices(symbols: list[str]) -> dict[str, dict]:
    """Get current prices for multiple tickers.

    Args:
        symbols: List of ticker symbols

    Returns:
        dict mapping symbol to price data (price, currency, valid)
    """
    results = {}
    for symbol in symbols:
        results[symbol.upper()] = get_current_price(symbol)
    return results
