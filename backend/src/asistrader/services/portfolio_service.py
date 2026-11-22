"""Portfolio business logic: Portfolios and their Transactions.

Every operation is scoped to one user — a Portfolio is only ever visible to,
and mutable by, its owner. A Portfolio not owned by the caller is reported as
not found, so its existence never leaks.
"""

import logging
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from asistrader.models.db import Portfolio, PortfolioTransaction, Ticker, TransactionKind
from asistrader.services import fx_service
from asistrader.services.fund_service import get_base_currency
from asistrader.services.market_data_service import ensure_ticker_with_history
from asistrader.services.portfolio_computation_service import (
    PortfolioFxUnavailableError,
    PortfolioReplayError,
    SummaryFigures,
    compute_summary,
    replay,
    transactions_of,
)

logger = logging.getLogger(__name__)


class PortfolioNotFoundError(Exception):
    """Raised when a Portfolio doesn't exist for the given user."""


class TransactionNotFoundError(Exception):
    """Raised when a Transaction doesn't exist in the given Portfolio."""


class PortfolioNameExistsError(Exception):
    """Raised when the user already has a Portfolio with that name."""


def list_portfolios(db: Session, user_id: int) -> list[Portfolio]:
    return (
        db.query(Portfolio)
        .filter(Portfolio.user_id == user_id)
        .order_by(Portfolio.name)
        .all()
    )


def get_portfolio(db: Session, user_id: int, portfolio_id: int) -> Portfolio:
    portfolio = (
        db.query(Portfolio)
        .filter(Portfolio.id == portfolio_id, Portfolio.user_id == user_id)
        .first()
    )
    if portfolio is None:
        raise PortfolioNotFoundError(f"Portfolio with ID {portfolio_id} not found")
    return portfolio


def _ensure_name_free(
    db: Session, user_id: int, name: str, exclude_id: int | None = None
) -> None:
    query = db.query(Portfolio).filter(
        Portfolio.user_id == user_id, Portfolio.name == name
    )
    if exclude_id is not None:
        query = query.filter(Portfolio.id != exclude_id)
    if query.first():
        raise PortfolioNameExistsError(f"A Portfolio named '{name}' already exists")


def create_portfolio(
    db: Session, user_id: int, name: str, currency: str | None = None
) -> Portfolio:
    name = name.strip()
    _ensure_name_free(db, user_id, name)
    portfolio = Portfolio(
        user_id=user_id,
        name=name,
        currency=(currency or get_base_currency(db, user_id)).upper(),
    )
    db.add(portfolio)
    db.commit()
    db.refresh(portfolio)
    return portfolio


def rename_portfolio(
    db: Session, user_id: int, portfolio_id: int, name: str
) -> Portfolio:
    portfolio = get_portfolio(db, user_id, portfolio_id)
    name = name.strip()
    _ensure_name_free(db, user_id, name, exclude_id=portfolio_id)
    portfolio.name = name
    db.commit()
    db.refresh(portfolio)
    return portfolio


def delete_portfolio(db: Session, user_id: int, portfolio_id: int) -> None:
    portfolio = get_portfolio(db, user_id, portfolio_id)
    db.delete(portfolio)
    db.commit()


# ── Transactions ──


def list_transactions(
    db: Session, user_id: int, portfolio_id: int
) -> list[PortfolioTransaction]:
    portfolio = get_portfolio(db, user_id, portfolio_id)
    return transactions_of(db, portfolio.id)


def _ensure_fx_history(db: Session, currencies: set[str], since: date) -> None:
    """Best-effort FX sync, so a stored rate exists for the dates being replayed.

    Only called when a rate turned out to be missing; a yfinance outage is
    swallowed and the replay then reports the missing rate itself.
    """
    for currency in currencies:
        try:
            fx_service.sync_fx_pair(db, currency, since)
        except Exception:
            logger.exception("FX sync failed for %s", currency)


def _validate(db: Session, portfolio: Portfolio) -> None:
    """Replay the full Transaction list; on failure undo the pending write."""
    try:
        replay(db, portfolio)
    except PortfolioReplayError:
        db.rollback()
        raise


def create_buy(
    db: Session,
    user_id: int,
    portfolio_id: int,
    *,
    on_date: date,
    ticker: str,
    units: Decimal,
    price: Decimal,
    fees: Decimal = Decimal(0),
    fx_rate: Decimal | None = None,
) -> PortfolioTransaction:
    """Record a Buy. An unknown ticker is created and its history loaded.

    Raises:
        PortfolioNotFoundError: the Portfolio isn't the user's.
        TickerValidationError: Yahoo doesn't know the ticker either.
        PortfolioReplayError: the Buy can't be costed (no FX rate, no currency).
    """
    portfolio = get_portfolio(db, user_id, portfolio_id)
    symbol = ticker.strip().upper()
    since = on_date - timedelta(days=fx_service.EARLIEST_DATE_BUFFER_DAYS)
    instrument = ensure_ticker_with_history(db, symbol, since)

    if fx_rate is None and instrument.currency:
        try:
            fx_service.convert(db, 1.0, instrument.currency, portfolio.currency, on_date)
        except fx_service.FxRateUnavailable:
            _ensure_fx_history(db, {instrument.currency, portfolio.currency}, since)

    transaction = PortfolioTransaction(
        portfolio_id=portfolio.id,
        kind=TransactionKind.BUY.value,
        date=on_date,
        ticker=symbol,
        units=units,
        price=price,
        fees=fees,
        fx_rate=fx_rate,
    )
    db.add(transaction)
    db.flush()
    _validate(db, portfolio)
    db.commit()
    db.refresh(transaction)
    return transaction


def delete_transaction(
    db: Session, user_id: int, portfolio_id: int, transaction_id: int
) -> None:
    """Delete a Transaction; the remaining list must still replay."""
    portfolio = get_portfolio(db, user_id, portfolio_id)
    transaction = (
        db.query(PortfolioTransaction)
        .filter(
            PortfolioTransaction.id == transaction_id,
            PortfolioTransaction.portfolio_id == portfolio.id,
        )
        .first()
    )
    if transaction is None:
        raise TransactionNotFoundError(f"Transaction with ID {transaction_id} not found")
    db.delete(transaction)
    db.flush()
    _validate(db, portfolio)
    db.commit()


# ── Summary ──


def get_summary(db: Session, user_id: int, portfolio_id: int) -> SummaryFigures:
    """Invested, Portfolio Value, Unrealized Gain and Holdings as of today.

    If a valuation-date FX rate is missing, sync the Portfolio's currencies
    once and retry before giving up.
    """
    portfolio = get_portfolio(db, user_id, portfolio_id)
    try:
        return compute_summary(db, portfolio)
    except PortfolioFxUnavailableError:
        transactions = transactions_of(db, portfolio.id)
        symbols = {tx.ticker for tx in transactions}
        currencies = {
            c
            for (c,) in db.query(Ticker.currency).filter(Ticker.symbol.in_(symbols))
            if c
        } | {portfolio.currency}
        since = min(tx.date for tx in transactions) - timedelta(
            days=fx_service.EARLIEST_DATE_BUFFER_DAYS
        )
        _ensure_fx_history(db, currencies, since)
        return compute_summary(db, portfolio)
