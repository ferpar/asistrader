"""Portfolio computation: replay Transactions into FIFO Lots, then value them.

This module is the single place where a Portfolio's Holdings are derived.
Every read (summary, and later history and KPIs) and every write validation
goes through `replay`, so a Transaction list always means the same thing
wherever it is looked at. Nothing is persisted: figures are recomputed on
request from Transactions, stored market data and FX rates.

Money is expressed in the Portfolio's currency. A Lot's cost is
`units × price + fees` in the instrument's currency, converted with the
Transaction's own FX rate when one was entered, else the stored rate for the
Transaction's date. A Sell consumes the oldest Lots first (FIFO) and is
rejected if it exceeds the units held at that point of the replay; its
proceeds net of fees, converted the same way, minus the consumed Lots' cost
accumulate into Realized Gain. Portfolio Value uses each instrument's latest raw close
(never the adjusted close — ADR 0002) converted at that close's date.
"""

from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from asistrader.models.db import (
    MarketData,
    Portfolio,
    PortfolioTransaction,
    Ticker,
    TransactionKind,
)
from asistrader.services import fx_service


class PortfolioReplayError(Exception):
    """A Transaction list that can't be replayed into a valid Portfolio state."""


class PortfolioFxUnavailableError(PortfolioReplayError):
    """No FX rate is available to convert an amount into the Portfolio currency."""


class InstrumentCurrencyUnknownError(PortfolioReplayError):
    """A Transaction's ticker has no known currency, so it can't be converted."""


class OversellError(PortfolioReplayError):
    """A Sell exceeds the units held at that point of the replay (long-only)."""


@dataclass
class Lot:
    """Units bought in one Buy, with their date and cost in Portfolio currency.

    A Sell that consumes part of a Lot shrinks its units and cost pro rata;
    the Lot keeps its original date.
    """

    ticker: str
    date: date
    units: Decimal
    cost: float


@dataclass
class Ledger:
    """The state a Transaction list leaves a Portfolio in: open Lots per ticker
    and the Realized Gain accumulated by Sells."""

    currency: str
    realized_gain: float = 0.0
    lots: dict[str, list[Lot]] = field(default_factory=lambda: defaultdict(list))
    instrument_currency: dict[str, str] = field(default_factory=dict)
    last_price: dict[str, tuple[date, float]] = field(default_factory=dict)

    def open_tickers(self) -> list[str]:
        return sorted(t for t, lots in self.lots.items() if lots)


@dataclass
class HoldingFigures:
    ticker: str
    name: str | None
    currency: str
    units: float
    cost: float
    value: float
    weight: float | None
    unrealized_gain: float
    unrealized_gain_pct: float | None
    last_price: float
    last_price_date: date


@dataclass
class SummaryFigures:
    currency: str
    as_of: date
    invested: float
    portfolio_value: float
    unrealized_gain: float
    unrealized_gain_pct: float | None
    realized_gain: float
    total_gain: float
    holdings: list[HoldingFigures]


def _to_portfolio_currency(
    db: Session, amount: float, from_ccy: str, to_ccy: str, on_date: date
) -> float:
    try:
        return fx_service.convert(db, amount, from_ccy, to_ccy, on_date)
    except fx_service.FxRateUnavailable as e:
        raise PortfolioFxUnavailableError(
            f"No {from_ccy}→{to_ccy} FX rate for {on_date.isoformat()}; "
            "enter the FX rate you paid"
        ) from e


def _transaction_amount(
    db: Session,
    tx: PortfolioTransaction,
    native_amount: float,
    instrument_ccy: str,
    portfolio_ccy: str,
) -> float:
    """Convert a Transaction's amount at its entered FX rate, else the stored one."""
    if tx.fx_rate is not None:
        return native_amount * float(tx.fx_rate)
    return _to_portfolio_currency(
        db, native_amount, instrument_ccy, portfolio_ccy, tx.date
    )


def _consume_fifo(lots: list[Lot], units: Decimal, tx: PortfolioTransaction) -> float:
    """Remove `units` from the oldest Lots first; return the cost consumed.

    Raises `OversellError` (leaving `lots` untouched) when fewer units are held.
    """
    held = sum((lot.units for lot in lots), Decimal(0))
    if units > held:
        raise OversellError(
            f"Sell of {units.normalize():f} {tx.ticker} on {tx.date.isoformat()} "
            f"exceeds the {held.normalize():f} units held then"
        )
    consumed = 0.0
    remaining = units
    while remaining > 0:
        lot = lots[0]
        if lot.units <= remaining:
            consumed += lot.cost
            remaining -= lot.units
            lots.pop(0)
        else:
            part = lot.cost * float(remaining / lot.units)
            consumed += part
            lot.cost -= part
            lot.units -= remaining
            remaining = Decimal(0)
    return consumed


def transactions_of(db: Session, portfolio_id: int) -> list[PortfolioTransaction]:
    """A Portfolio's Transactions in replay order (date, then entry order)."""
    return (
        db.query(PortfolioTransaction)
        .filter(PortfolioTransaction.portfolio_id == portfolio_id)
        .order_by(PortfolioTransaction.date, PortfolioTransaction.id)
        .all()
    )


def replay(
    db: Session,
    portfolio: Portfolio,
    on_new_date: Callable[[date, Ledger], None] | None = None,
) -> Ledger:
    """Replay the Portfolio's Transactions in date order into FIFO Lots.

    `on_new_date(d, ledger)`, if given, is called just before the first
    Transaction dated `d` is applied, so `ledger` is the state at the close
    of every day before `d`. It lets the daily history walk the replay once
    instead of replaying again for each day.

    Raises a `PortfolioReplayError` subclass when the list can't be replayed.
    """
    transactions = transactions_of(db, portfolio.id)
    symbols = {tx.ticker for tx in transactions}
    currencies = dict(
        db.query(Ticker.symbol, Ticker.currency).filter(Ticker.symbol.in_(symbols)).all()
    )

    ledger = Ledger(currency=portfolio.currency)
    replayed_date: date | None = None
    for tx in transactions:
        if on_new_date is not None and tx.date != replayed_date:
            on_new_date(tx.date, ledger)
            replayed_date = tx.date
        ccy = currencies.get(tx.ticker)
        if ccy is None:
            raise InstrumentCurrencyUnknownError(
                f"The currency of {tx.ticker} is unknown"
            )
        ledger.instrument_currency[tx.ticker] = ccy

        if tx.kind == TransactionKind.BUY.value:
            units = Decimal(tx.units)
            native_cost = float(units * Decimal(tx.price) + Decimal(tx.fees or 0))
            cost = _transaction_amount(db, tx, native_cost, ccy, portfolio.currency)
            ledger.lots[tx.ticker].append(
                Lot(ticker=tx.ticker, date=tx.date, units=units, cost=cost)
            )
            ledger.last_price[tx.ticker] = (tx.date, float(tx.price))
        elif tx.kind == TransactionKind.SELL.value:
            units = Decimal(tx.units)
            consumed_cost = _consume_fifo(ledger.lots[tx.ticker], units, tx)
            native_proceeds = float(units * Decimal(tx.price) - Decimal(tx.fees or 0))
            proceeds = _transaction_amount(
                db, tx, native_proceeds, ccy, portfolio.currency
            )
            ledger.realized_gain += proceeds - consumed_cost
            ledger.last_price[tx.ticker] = (tx.date, float(tx.price))
        else:
            raise PortfolioReplayError(f"Unsupported Transaction kind: {tx.kind}")

    return ledger


def _latest_close(db: Session, symbol: str, as_of: date) -> tuple[date, float] | None:
    row = (
        db.query(MarketData.date, MarketData.close)
        .filter(
            MarketData.ticker == symbol,
            MarketData.date <= as_of,
            MarketData.close.isnot(None),
        )
        .order_by(MarketData.date.desc())
        .first()
    )
    return (row[0], row[1]) if row else None


def compute_summary(
    db: Session, portfolio: Portfolio, as_of: date | None = None
) -> SummaryFigures:
    """Invested, Portfolio Value, Unrealized / Realized / Total Gain and
    Holdings as of `as_of`.

    A Holding is valued at its latest raw close on or before `as_of`; an
    instrument with no stored close yet is valued at its latest Transaction
    price, so a fresh Buy still shows up instead of vanishing.
    """
    as_of = as_of or date.today()
    ledger = replay(db, portfolio)
    names = dict(
        db.query(Ticker.symbol, Ticker.name)
        .filter(Ticker.symbol.in_(ledger.open_tickers()))
        .all()
    )

    rows: list[dict] = []
    for symbol in ledger.open_tickers():
        lots = ledger.lots[symbol]
        units = sum((lot.units for lot in lots), Decimal(0))
        cost = sum(lot.cost for lot in lots)
        price_date, price = _latest_close(db, symbol, as_of) or ledger.last_price[symbol]
        ccy = ledger.instrument_currency[symbol]
        value = _to_portfolio_currency(
            db, float(units) * price, ccy, portfolio.currency, price_date
        )
        rows.append(
            dict(
                ticker=symbol,
                name=names.get(symbol),
                currency=ccy,
                units=float(units),
                cost=cost,
                value=value,
                last_price=price,
                last_price_date=price_date,
            )
        )

    invested = sum(r["cost"] for r in rows)
    portfolio_value = sum(r["value"] for r in rows)
    holdings = [
        HoldingFigures(
            **r,
            weight=r["value"] / portfolio_value if portfolio_value else None,
            unrealized_gain=r["value"] - r["cost"],
            unrealized_gain_pct=(r["value"] - r["cost"]) / r["cost"] if r["cost"] else None,
        )
        for r in rows
    ]
    unrealized = portfolio_value - invested
    return SummaryFigures(
        currency=portfolio.currency,
        as_of=as_of,
        invested=invested,
        portfolio_value=portfolio_value,
        unrealized_gain=unrealized,
        unrealized_gain_pct=unrealized / invested if invested else None,
        realized_gain=ledger.realized_gain,
        total_gain=unrealized + ledger.realized_gain,
        holdings=holdings,
    )
