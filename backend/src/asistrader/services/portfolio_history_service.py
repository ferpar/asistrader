"""Portfolio daily history: the Portfolio's KPIs on every business day.

One row per business day (Mon–Fri) from the first Transaction to today.
The rows are derived from the same `replay` that produces the summary, walked
once: `replay` reports the Ledger at the close of each day before a new
Transaction date, and every business day up to that date is valued from it.
So a multi-year history costs one replay plus one pass over the days, not a
replay per day. Nothing is persisted; editing a Transaction changes the next
request.

Each day is valued by `portfolio_computation_service.Valuation`, the same
valuation the summary uses: each instrument at its latest stored close on or
before that day (so a market holiday carries it forward), or its latest
Transaction price before its first close, converted at the latest stored FX
rate on or before that day. Only a day with no earlier rate at all is an
error.

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

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from asistrader.models.db import Portfolio
from asistrader.services.daily_series import business_days
from asistrader.services.portfolio_computation_service import (
    Ledger,
    Valuation,
    gain,
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


class _HistoryBuilder:
    def __init__(
        self, db: Session, portfolio: Portfolio, start: date | None, end: date
    ) -> None:
        self.start = start
        self.end = end
        self.history = HistoryFigures(currency=portfolio.currency)
        self.valuation = Valuation(db, portfolio.currency, end)
        self.next_day: date | None = None
        # Performance Index state, chained over every business day from the
        # first Transaction (also the days before `start`, which aren't emitted).
        self._index: float | None = None
        self._previous_value = 0.0
        self._flows_applied = 0

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
        symbols = ledger.open_tickers()
        units = {
            s: float(sum((lot.units for lot in ledger.lots[s]), Decimal(0))) for s in symbols
        }
        invested = sum(lot.cost for s in symbols for lot in ledger.lots[s])
        realized = ledger.realized_gain
        lots = [lot for s in symbols for lot in ledger.lots[s]]

        for day in business_days(self.next_day, stop):
            value = 0.0
            for s in symbols:
                _, price = self.valuation.price(ledger, s, day)
                value += units[s] * price * self.valuation.fx_factor(
                    ledger.instrument_currency[s], day
                )
            index = self._chain_index(day, value, ledger)
            if self.start is not None and day < self.start:
                continue
            g = gain(value, invested, realized)
            self.history.dates.append(day)
            self.history.invested.append(invested)
            self.history.portfolio_value.append(value)
            self.history.unrealized_gain.append(g.unrealized)
            self.history.unrealized_gain_pct.append(g.unrealized_pct)
            self.history.realized_gain.append(realized)
            self.history.total_gain.append(g.total)
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
