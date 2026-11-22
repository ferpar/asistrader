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
    OversellError,
    PortfolioFxUnavailableError,
    PortfolioReplayError,
    SummaryFigures,
    compute_summary,
    replay,
    transactions_of,
)
from asistrader.services.portfolio_history_service import HistoryFigures, compute_history

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


def _prepare_instrument(
    db: Session,
    portfolio: Portfolio,
    kind: TransactionKind,
    symbol: str,
    on_date: date,
    fx_rate: Decimal | None,
) -> None:
    """Make sure the ticker and the FX rate a Transaction needs are stored.

    A Buy of an unknown ticker creates it and loads its history. A Sell can
    only be of a ticker already held, so an unknown one is an oversell.
    """
    since = on_date - timedelta(days=fx_service.EARLIEST_DATE_BUFFER_DAYS)
    if kind == TransactionKind.BUY:
        instrument = ensure_ticker_with_history(db, symbol, since)
    else:
        instrument = db.get(Ticker, symbol)
        if instrument is None:
            raise OversellError(f"No units of {symbol} are held to sell")

    if fx_rate is None and instrument.currency:
        try:
            fx_service.convert(db, 1.0, instrument.currency, portfolio.currency, on_date)
        except fx_service.FxRateUnavailable:
            _ensure_fx_history(db, {instrument.currency, portfolio.currency}, since)


def create_transaction(
    db: Session,
    user_id: int,
    portfolio_id: int,
    *,
    kind: TransactionKind,
    on_date: date,
    ticker: str,
    units: Decimal,
    price: Decimal,
    fees: Decimal = Decimal(0),
    fx_rate: Decimal | None = None,
) -> PortfolioTransaction:
    """Record a Buy or Sell, validated by replaying the full Transaction list.

    Raises:
        PortfolioNotFoundError: the Portfolio isn't the user's.
        TickerValidationError: a Buy's ticker is unknown to Yahoo too.
        PortfolioReplayError: the list no longer replays — e.g. the Transaction
            can't be costed (no FX rate, no currency) or a Sell oversells.
    """
    portfolio = get_portfolio(db, user_id, portfolio_id)
    symbol = ticker.strip().upper()
    _prepare_instrument(db, portfolio, kind, symbol, on_date, fx_rate)

    transaction = PortfolioTransaction(
        portfolio_id=portfolio.id,
        kind=kind.value,
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


def _get_transaction(
    db: Session, portfolio: Portfolio, transaction_id: int
) -> PortfolioTransaction:
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
    return transaction


def update_transaction(
    db: Session,
    user_id: int,
    portfolio_id: int,
    transaction_id: int,
    *,
    kind: TransactionKind,
    on_date: date,
    ticker: str,
    units: Decimal,
    price: Decimal,
    fees: Decimal = Decimal(0),
    fx_rate: Decimal | None = None,
) -> PortfolioTransaction:
    """Replace a Transaction's fields; the whole list must still replay.

    An edit that makes any later Sell oversell is rejected and nothing changes.
    Raises the same errors as `create_transaction`, plus
    `TransactionNotFoundError`.
    """
    portfolio = get_portfolio(db, user_id, portfolio_id)
    transaction = _get_transaction(db, portfolio, transaction_id)
    symbol = ticker.strip().upper()
    _prepare_instrument(db, portfolio, kind, symbol, on_date, fx_rate)

    transaction.kind = kind.value
    transaction.date = on_date
    transaction.ticker = symbol
    transaction.units = units
    transaction.price = price
    transaction.fees = fees
    transaction.fx_rate = fx_rate
    db.flush()
    _validate(db, portfolio)
    db.commit()
    db.refresh(transaction)
    return transaction


def delete_transaction(
    db: Session, user_id: int, portfolio_id: int, transaction_id: int
) -> None:
    """Delete a Transaction; the remaining list must still replay, so deleting
    a Buy that a later Sell depends on is rejected as an oversell."""
    portfolio = get_portfolio(db, user_id, portfolio_id)
    transaction = _get_transaction(db, portfolio, transaction_id)
    db.delete(transaction)
    db.flush()
    _validate(db, portfolio)
    db.commit()


# ── Summary ──


def get_summary(db: Session, user_id: int, portfolio_id: int) -> SummaryFigures:
    """Invested, Portfolio Value, Unrealized / Realized / Total Gain and
    Holdings as of today.

    If a valuation-date FX rate is missing, sync the Portfolio's currencies
    once and retry before giving up.
    """
    portfolio = get_portfolio(db, user_id, portfolio_id)
    try:
        return compute_summary(db, portfolio)
    except PortfolioFxUnavailableError:
        _sync_portfolio_fx(db, portfolio)
        return compute_summary(db, portfolio)


def get_history(
    db: Session,
    user_id: int,
    portfolio_id: int,
    start: date | None = None,
    end: date | None = None,
) -> HistoryFigures:
    """The Portfolio's daily rows, one per business day from its first
    Transaction to today, optionally narrowed to [start, end].

    Like the summary, a missing FX rate triggers one sync of the Portfolio's
    currencies and a retry.
    """
    portfolio = get_portfolio(db, user_id, portfolio_id)
    try:
        return compute_history(db, portfolio, start, end)
    except PortfolioFxUnavailableError:
        _sync_portfolio_fx(db, portfolio)
        return compute_history(db, portfolio, start, end)


def _sync_portfolio_fx(db: Session, portfolio: Portfolio) -> None:
    """Load FX rates for the Portfolio's currencies since its first Transaction."""
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
