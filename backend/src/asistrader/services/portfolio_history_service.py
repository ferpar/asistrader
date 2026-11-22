"""Portfolio daily history: the Portfolio's KPIs on every business day.

One row per business day (Mon–Fri) from the first Transaction to today.
The rows are derived from the same `replay` that produces the summary, walked
once: `replay` reports the Ledger at the close of each day before a new
Transaction date, and every business day up to that date is valued from it.
So a multi-year history costs one replay plus one pass over the days, not a
replay per day. Nothing is persisted; editing a Transaction changes the next
request.

Valuation of a day:
- Each instrument is valued at its latest raw close on or before that day
  (ADR 0002), so a market holiday carries the last close forward. Before an
  instrument's first stored close it is valued at its latest Transaction
  price, the same fallback the summary uses.
- Values are converted into the Portfolio currency at that day's stored FX
  rate; a day without a stored rate (weekend, FX holiday, sync gap) uses the
  latest earlier one. Only a day with no earlier rate at all is an error.

Performance Index (time-weighted, so Buys and Sells don't look like
performance): each day's return is (Value_t − net flow_t) / Value_{t−1} − 1,
where net flow_t is that day's Buy cost minus Sell proceeds in Portfolio
currency, fees included exactly as in the Ledger's cash flows (so fees do
drag the index). Flows are taken at the close: the units a Buy adds earn the
move from their price to that day's close. The index is 100 on the first
business day and is chained from there; a day whose previous value is 0
(before anything is held, or after selling everything and re-buying later)
has no base to earn on, so the index carries flat. It is always chained from
the first Transaction, so narrowing the range with `start` doesn't rebase it.
"""

from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from asistrader.models.db import FxRate, MarketData, Portfolio
from asistrader.services.fx_service import _normalize_currency
from asistrader.services.portfolio_computation_service import (
    Ledger,
    PortfolioFxUnavailableError,
    replay,
    weighted_days_open,
)


@dataclass
class HistoryFigures:
    """The daily rows as parallel columns: column[i] is the figure on dates[i]."""

    currency: str
    dates: list[date] = field(default_factory=list)
    invested: list[float] = field(default_factory=list)
    portfolio_value: list[float] = field(default_factory=list)
    unrealized_gain: list[float] = field(default_factory=list)
    unrealized_gain_pct: list[float | None] = field(default_factory=list)
    realized_gain: list[float] = field(default_factory=list)
    total_gain: list[float] = field(default_factory=list)
    weighted_days_open: list[float | None] = field(default_factory=list)
    performance_index: list[float] = field(default_factory=list)


class _CarriedSeries:
    """A dated series read on increasing days: `at(day)` is the latest value
    on or before `day`, or None before the first one."""

    def __init__(self, points: list[tuple[date, float]]) -> None:
        self._points = points
        self._next = 0
        self._current: float | None = None

    def at(self, day: date) -> float | None:
        while self._next < len(self._points) and self._points[self._next][0] <= day:
            self._current = self._points[self._next][1]
            self._next += 1
        return self._current


@dataclass
class _HoldingState:
    """One instrument's open Lots, frozen between two Transaction dates."""

    ticker: str
    currency: str
    units: float
    fallback_price: float


def _business_days(start: date, end: date) -> Iterator[date]:
    day = start
    while day <= end:
        if day.weekday() < 5:
            yield day
        day += timedelta(days=1)


class _HistoryBuilder:
    def __init__(
        self, db: Session, portfolio: Portfolio, start: date | None, end: date
    ) -> None:
        self.db = db
        self.start = start
        self.end = end
        self.currency = portfolio.currency
        self.history = HistoryFigures(currency=portfolio.currency)
        self.next_day: date | None = None
        self._closes: dict[str, _CarriedSeries] = {}
        self._fx: dict[str, _CarriedSeries] = {}
        # Performance Index state, chained over every business day from the
        # first Transaction (also the days before `start`, which aren't emitted).
        self._index: float | None = None
        self._previous_value = 0.0
        self._flows_applied = 0

    def _rate_to_usd(self, currency: str, day: date) -> float:
        """USD per unit of `currency` on `day`, carried forward from the
        latest stored rate (mirrors `fx_service.get_rate_to_usd`, preloaded)."""
        canonical, divisor = _normalize_currency(currency)
        if canonical == "USD":
            return 1.0 / divisor
        if canonical not in self._fx:
            rows = (
                self.db.query(FxRate.date, FxRate.rate_to_usd)
                .filter(FxRate.currency == canonical, FxRate.date <= self.end)
                .order_by(FxRate.date)
                .all()
            )
            self._fx[canonical] = _CarriedSeries([(d, r) for d, r in rows])
        rate = self._fx[canonical].at(day)
        if rate is None:
            raise PortfolioFxUnavailableError(
                f"No {canonical} FX rate on or before {day.isoformat()}"
            )
        return rate / divisor

    def _close_series(self, symbol: str) -> _CarriedSeries:
        if symbol not in self._closes:
            rows = (
                self.db.query(MarketData.date, MarketData.close)
                .filter(
                    MarketData.ticker == symbol,
                    MarketData.date <= self.end,
                    MarketData.close.isnot(None),
                )
                .order_by(MarketData.date)
                .all()
            )
            self._closes[symbol] = _CarriedSeries([(d, c) for d, c in rows])
        return self._closes[symbol]

    def _fx_factor(self, currency: str, day: date) -> float:
        """Portfolio-currency units per unit of `currency` on `day`."""
        if currency == self.currency:
            return 1.0
        return self._rate_to_usd(currency, day) / self._rate_to_usd(self.currency, day)

    def _chain_index(self, day: date, value: float, ledger: Ledger) -> float:
        """The Performance Index at the close of `day`, given its Portfolio Value.

        The day's net flow is the Buy cost minus the Sell proceeds (fees
        included, as in the Ledger's cash flows) of every Transaction since
        the previous row, so a weekend Transaction counts on the next
        business day. When the previous day's value is 0 (the first day, or
        a day after selling everything) there is nothing to earn a return
        on, so the index carries flat.
        """
        net_flow = 0.0
        flows = ledger.cash_flows
        while self._flows_applied < len(flows) and flows[self._flows_applied][0] <= day:
            net_flow -= flows[self._flows_applied][1]
            self._flows_applied += 1
        if self._index is None:
            self._index = 100.0
        elif self._previous_value > 0:
            self._index *= (value - net_flow) / self._previous_value
        self._previous_value = value
        return self._index

    def on_new_date(self, tx_date: date, ledger: Ledger) -> None:
        if self.next_day is None:
            self.next_day = tx_date
        self.emit_until(min(tx_date - timedelta(days=1), self.end), ledger)

    def emit_until(self, stop: date, ledger: Ledger) -> None:
        """Add a row for every business day from `next_day` to `stop`, all
        valued from the same Ledger."""
        if self.next_day is None or stop < self.next_day:
            return
        holdings = []
        invested = 0.0
        for symbol in ledger.open_tickers():
            lots = ledger.lots[symbol]
            invested += sum(lot.cost for lot in lots)
            holdings.append(
                _HoldingState(
                    ticker=symbol,
                    currency=ledger.instrument_currency[symbol],
                    units=float(sum((lot.units for lot in lots), Decimal(0))),
                    fallback_price=ledger.last_price[symbol][1],
                )
            )
        realized = ledger.realized_gain
        lots = [lot for symbol in ledger.open_tickers() for lot in ledger.lots[symbol]]

        for day in _business_days(self.next_day, stop):
            value = 0.0
            for h in holdings:
                close = self._close_series(h.ticker).at(day)
                price = close if close is not None else h.fallback_price
                value += h.units * price * self._fx_factor(h.currency, day)
            index = self._chain_index(day, value, ledger)
            if self.start is not None and day < self.start:
                continue
            unrealized = value - invested
            self.history.dates.append(day)
            self.history.invested.append(invested)
            self.history.portfolio_value.append(value)
            self.history.unrealized_gain.append(unrealized)
            self.history.unrealized_gain_pct.append(
                unrealized / invested if invested else None
            )
            self.history.realized_gain.append(realized)
            self.history.total_gain.append(unrealized + realized)
            self.history.weighted_days_open.append(weighted_days_open(lots, day))
            self.history.performance_index.append(index)
        self.next_day = stop + timedelta(days=1)


def compute_history(
    db: Session,
    portfolio: Portfolio,
    start: date | None = None,
    end: date | None = None,
) -> HistoryFigures:
    """Daily rows from the first Transaction (or `start`, if later) to today
    (or `end`, if earlier)."""
    end = min(end or date.today(), date.today())
    builder = _HistoryBuilder(db, portfolio, start, end)
    final = replay(db, portfolio, on_new_date=builder.on_new_date)
    builder.emit_until(end, final)
    return builder.history
