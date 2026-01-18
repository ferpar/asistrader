"""Ticker business logic service."""

from sqlalchemy.orm import Session

from asistrader.models.db import Ticker


def get_all_tickers(db: Session) -> list[Ticker]:
    """Get all tickers from the database ordered by symbol."""
    return db.query(Ticker).order_by(Ticker.symbol).all()


def get_ticker_by_symbol(db: Session, symbol: str) -> Ticker | None:
    """Get a single ticker by symbol."""
    return db.query(Ticker).filter(Ticker.symbol == symbol).first()
