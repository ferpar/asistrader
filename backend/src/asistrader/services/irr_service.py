"""IRR / TIR ("Drivers") analysis service.

Computes per-trade, per-ticker and portfolio return metrics for the Drivers
page. Two annualization methods are produced for every figure:

  * TIR  — the beta-user's simple linear annualization:
               return% / holding_days x 365
  * XIRR — true compound (money-weighted) internal rate of return.

The holding period runs from ``date_ordered`` (capital committed to the
broker) to ``exit_date`` for closed trades, or to today for still-open trades.

Cross-currency aggregation is done in the user's base currency; each cash flow
is converted at its own economic date. Per-trade ``return_pct`` is kept in the
trade's native currency so it reflects pure trading performance, FX-neutral.

Realized scope  = closed trades.
Unrealized scope = open trades, marked at the current market price.
The Daily section is derived from closed trades only (open trades have no
close date to bucket by).
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date

from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from asistrader.models.db import Trade, TradeStatus
from asistrader.services import fx_service
from asistrader.services.fund_service import get_base_currency
from asistrader.services.fx_service import FxRateUnavailable
from asistrader.services.ticker_service import get_batch_prices

ANNUAL_DAYS = 365


# ── Response schemas ──────────────────────────────────────────────────────


class TradeIrr(BaseModel):
    """Per-transaction IRR metrics."""

    trade_id: int
    ticker: str
    ticker_name: str | None = None
    currency: str
    status: str
    date_ordered: date | None = None
    exit_date: date | None = None
    holding_days: int
    investment_native: float
    profit_native: float
    investment_base: float
    profit_base: float
    return_pct: float
    tir: float
    xirr: float | None = None
    is_winner: bool


class GroupIrr(BaseModel):
    """Aggregated IRR for a ticker (all its trades) or the whole portfolio."""

    label: str
    ticker_name: str | None = None
    trade_count: int
    investment_base: float
    profit_base: float
    return_pct: float
    avg_holding_days: float
    tir: float
    xirr: float | None = None


class ScopeBlock(BaseModel):
    """A realized or unrealized scope: per-trade, per-ticker and portfolio.

    ``by_ticker`` aggregates every trade of a ticker (the "mixed" view).
    ``by_ticker_winners`` / ``by_ticker_losers`` re-aggregate the same tickers
    using only their winning / losing trades, so a ticker's winners can be read
    without cross-contamination from its losers (and vice versa).
    """

    transactions: list[TradeIrr]
    by_ticker: list[GroupIrr]
    by_ticker_winners: list[GroupIrr]
    by_ticker_losers: list[GroupIrr]
    portfolio: GroupIrr | None = None


class DailyPoint(BaseModel):
    """One calendar day of closed-trade activity.

    ``enhanced_*`` and ``idle_*`` are populated for the 'mixed' series only —
    per the spec, winners/losers views apply to the daily TIR, not Enhanced.
    """

    date: date
    trade_count: int
    investment_base: float
    profit_base: float
    return_pct: float
    avg_holding_days: float
    tir: float
    enhanced_return_pct: float | None = None
    enhanced_tir: float | None = None
    idle_pool_base: float | None = None
    idle_trade_count: int | None = None


class DailyBlock(BaseModel):
    """Daily annualized TIR series in three views."""

    mixed: list[DailyPoint]
    winners: list[DailyPoint]
    losers: list[DailyPoint]


class IrrAnalysis(BaseModel):
    """Full payload for the Drivers page."""

    base_currency: str
    realized: ScopeBlock
    unrealized: ScopeBlock
    daily: DailyBlock


# ── Math helpers ──────────────────────────────────────────────────────────


def _holding_days(start: date, end: date) -> int:
    """Calendar days held, clamped to a minimum of 1 to avoid div-by-zero."""
    return max((end - start).days, 1)


def _simple_tir(return_pct: float, days: int) -> float:
    """The beta-user's linear annualization: return% / days x 365."""
    return return_pct / days * ANNUAL_DAYS


def _two_flow_xirr(investment: float, proceeds: float, days: int) -> float | None:
    """Closed-form compound IRR for a single -investment / +proceeds pair.

    Equivalent to solving (1+r)^(days/365) = proceeds/investment. Undefined
    when the position was wiped out (proceeds <= 0).
    """
    if investment <= 0 or proceeds <= 0:
        return None
    return (proceeds / investment) ** (ANNUAL_DAYS / days) - 1.0


def _xnpv(rate: float, cashflows: list[tuple[date, float]], t0: date) -> float:
    """Net present value of dated cash flows at an annual ``rate``."""
    return sum(
        cf / (1.0 + rate) ** ((d - t0).days / ANNUAL_DAYS) for d, cf in cashflows
    )


def _xirr(cashflows: list[tuple[date, float]]) -> float | None:
    """Money-weighted IRR for arbitrary dated cash flows, via bisection.

    Returns None when the flows have no sign change (IRR undefined) or when the
    root falls outside the search bracket — XIRR on sub-month trades genuinely
    explodes off the chart, and there is nothing meaningful to show.
    """
    if len(cashflows) < 2:
        return None
    amounts = [cf for _, cf in cashflows]
    if not (any(a < 0 for a in amounts) and any(a > 0 for a in amounts)):
        return None

    t0 = min(d for d, _ in cashflows)
    lo, hi = -0.9999, 1e9
    f_lo = _xnpv(lo, cashflows, t0)
    f_hi = _xnpv(hi, cashflows, t0)
    if f_lo * f_hi > 0:
        return None

    for _ in range(200):
        mid = (lo + hi) / 2.0
        f_mid = _xnpv(mid, cashflows, t0)
        if abs(f_mid) < 1e-9:
            return mid
        if f_lo * f_mid < 0:
            hi = mid
        else:
            lo, f_lo = mid, f_mid
    return (lo + hi) / 2.0


# ── Internal per-trade record ─────────────────────────────────────────────


@dataclass
class _Rec:
    """Everything computed for one trade — feeds both output and aggregation."""

    trade: Trade
    ccy: str
    start: date
    end: date
    days: int
    inv_native: float
    profit_native: float
    inv_base: float
    profit_base: float
    proceeds_base: float
    return_pct: float
    tir: float
    xirr: float | None
    is_winner: bool


def _to_base(
    db: Session, amount: float, ccy: str, base: str, on_date: date
) -> float:
    """Convert to base currency; fall back to the native amount if no FX rate."""
    if ccy == base:
        return amount
    try:
        return fx_service.convert(db, amount, ccy, base, on_date)
    except FxRateUnavailable:
        return amount


def _build_rec(
    db: Session,
    trade: Trade,
    base: str,
    exit_price: float,
    end: date,
) -> _Rec:
    """Compute a trade's metrics given a settlement price and date."""
    ccy = (trade.ticker_rel.currency if trade.ticker_rel else None) or base
    start = trade.date_ordered or trade.date_planned
    inv_native = trade.amount or (trade.entry_price * trade.units)
    profit_native = (exit_price - trade.entry_price) * trade.units
    proceeds_native = inv_native + profit_native
    days = _holding_days(start, end)
    return_pct = profit_native / inv_native if inv_native else 0.0

    inv_base = _to_base(db, inv_native, ccy, base, start)
    proceeds_base = _to_base(db, proceeds_native, ccy, base, end)
    profit_base = proceeds_base - inv_base

    return _Rec(
        trade=trade,
        ccy=ccy,
        start=start,
        end=end,
        days=days,
        inv_native=inv_native,
        profit_native=profit_native,
        inv_base=inv_base,
        profit_base=profit_base,
        proceeds_base=proceeds_base,
        return_pct=return_pct,
        tir=_simple_tir(return_pct, days),
        xirr=_two_flow_xirr(inv_native, proceeds_native, days),
        is_winner=profit_native > 0,
    )


def _rec_to_trade_irr(rec: _Rec) -> TradeIrr:
    t = rec.trade
    return TradeIrr(
        trade_id=t.id,
        ticker=t.ticker,
        ticker_name=t.ticker_rel.name if t.ticker_rel else None,
        currency=rec.ccy,
        status=t.status.value,
        date_ordered=t.date_ordered or t.date_planned,
        exit_date=t.exit_date,
        holding_days=rec.days,
        investment_native=rec.inv_native,
        profit_native=rec.profit_native,
        investment_base=rec.inv_base,
        profit_base=rec.profit_base,
        return_pct=rec.return_pct,
        tir=rec.tir,
        xirr=rec.xirr,
        is_winner=rec.is_winner,
    )


def _group(label: str, recs: list[_Rec], ticker_name: str | None = None) -> GroupIrr:
    """Aggregate a set of trades into one IRR figure (capital-weighted)."""
    inv = sum(r.inv_base for r in recs)
    profit = sum(r.profit_base for r in recs)
    avg_days = sum(r.days for r in recs) / len(recs)
    return_pct = profit / inv if inv else 0.0
    cashflows: list[tuple[date, float]] = []
    for r in recs:
        cashflows.append((r.start, -r.inv_base))
        cashflows.append((r.end, r.proceeds_base))
    return GroupIrr(
        label=label,
        ticker_name=ticker_name,
        trade_count=len(recs),
        investment_base=inv,
        profit_base=profit,
        return_pct=return_pct,
        avg_holding_days=avg_days,
        tir=_simple_tir(return_pct, avg_days) if avg_days else 0.0,
        xirr=_xirr(cashflows),
    )


def _by_ticker(recs: list[_Rec]) -> list[GroupIrr]:
    """Aggregate records into one GroupIrr per ticker, sorted by symbol."""
    grouped: dict[str, list[_Rec]] = defaultdict(list)
    for r in recs:
        grouped[r.trade.ticker].append(r)
    return [
        _group(
            ticker,
            trecs,
            ticker_name=trecs[0].trade.ticker_rel.name
            if trecs[0].trade.ticker_rel
            else None,
        )
        for ticker, trecs in sorted(grouped.items())
    ]


def _build_scope(recs: list[_Rec], portfolio_label: str) -> ScopeBlock:
    """Assemble a realized/unrealized scope from its per-trade records."""
    winners = [r for r in recs if r.is_winner]
    losers = [r for r in recs if r.profit_native < 0]
    return ScopeBlock(
        transactions=[_rec_to_trade_irr(r) for r in recs],
        by_ticker=_by_ticker(recs),
        by_ticker_winners=_by_ticker(winners),
        by_ticker_losers=_by_ticker(losers),
        portfolio=_group(portfolio_label, recs) if recs else None,
    )


# ── Daily series ──────────────────────────────────────────────────────────


@dataclass
class _Committed:
    """A trade that tied up capital — used to size the Enhanced idle pool."""

    committed_date: date
    inv_base: float
    exit_date: date | None


def _daily_point(day: date, recs: list[_Rec]) -> DailyPoint:
    """Plain daily TIR point (no Enhanced) for a set of same-day closes."""
    inv = sum(r.inv_base for r in recs)
    profit = sum(r.profit_base for r in recs)
    avg_days = sum(r.days for r in recs) / len(recs)
    return_pct = profit / inv if inv else 0.0
    return DailyPoint(
        date=day,
        trade_count=len(recs),
        investment_base=inv,
        profit_base=profit,
        return_pct=return_pct,
        avg_holding_days=avg_days,
        tir=_simple_tir(return_pct, avg_days) if avg_days else 0.0,
    )


def _build_daily(closed: list[_Rec], committed: list[_Committed]) -> DailyBlock:
    """Build the mixed / winners / losers daily series.

    Enhanced is computed for the mixed series only. Its denominator charges
    each day a share of the idle capital pool — trades that were ordered or
    open as of that day but produced no closed result that day.
    """
    by_day: dict[date, list[_Rec]] = defaultdict(list)
    for r in closed:
        by_day[r.end].append(r)

    mixed: list[DailyPoint] = []
    winners: list[DailyPoint] = []
    losers: list[DailyPoint] = []

    for day in sorted(by_day):
        day_recs = by_day[day]

        point = _daily_point(day, day_recs)
        # Enhanced: idle pool = trades ordered/open as of `day` but not closed
        # on or before it (a later-closed trade was still open back then).
        idle = [
            c
            for c in committed
            if c.committed_date <= day
            and (c.exit_date is None or c.exit_date > day)
        ]
        idle_pool = sum(c.inv_base for c in idle)
        per_slot = idle_pool / len(idle) if idle else 0.0
        enh_denom = point.investment_base + per_slot * len(day_recs)
        if enh_denom:
            point.enhanced_return_pct = point.profit_base / enh_denom
            point.enhanced_tir = _simple_tir(
                point.enhanced_return_pct, point.avg_holding_days
            )
        point.idle_pool_base = idle_pool
        point.idle_trade_count = len(idle)
        mixed.append(point)

        win_recs = [r for r in day_recs if r.is_winner]
        if win_recs:
            winners.append(_daily_point(day, win_recs))
        lose_recs = [r for r in day_recs if r.profit_native < 0]
        if lose_recs:
            losers.append(_daily_point(day, lose_recs))

    return DailyBlock(mixed=mixed, winners=winners, losers=losers)


# ── Entry point ───────────────────────────────────────────────────────────


def compute_analysis(db: Session, user_id: int) -> IrrAnalysis:
    """Compute the full Drivers/IRR payload for a user."""
    base = get_base_currency(db, user_id)

    trades = (
        db.query(Trade)
        .options(joinedload(Trade.ticker_rel))
        .filter(Trade.user_id == user_id)
        .all()
    )

    closed = [
        t
        for t in trades
        if t.status == TradeStatus.CLOSE
        and t.exit_date is not None
        and t.exit_price is not None
    ]
    open_trades = [t for t in trades if t.status == TradeStatus.OPEN]
    ordered_trades = [t for t in trades if t.status == TradeStatus.ORDERED]

    # Realized scope.
    realized_recs = [_build_rec(db, t, base, t.exit_price, t.exit_date) for t in closed]

    # Unrealized scope — mark open trades at the current market price.
    today = date.today()
    prices: dict[str, dict] = {}
    if open_trades:
        try:
            prices = get_batch_prices([t.ticker for t in open_trades], db=db)
        except Exception:
            prices = {}
    unrealized_recs: list[_Rec] = []
    for t in open_trades:
        quote = prices.get(t.ticker.upper())
        if not quote or not quote.get("valid"):
            continue  # no live price — cannot mark this position
        unrealized_recs.append(_build_rec(db, t, base, quote["price"], today))

    # Enhanced idle pool: every trade that committed capital (ordered/open/
    # closed), with its committed date and exit date so we can reconstruct the
    # pool as of any past day.
    committed: list[_Committed] = []
    for r in realized_recs:
        committed.append(_Committed(r.start, r.inv_base, r.trade.exit_date))
    for r in unrealized_recs:
        committed.append(_Committed(r.start, r.inv_base, None))
    for t in ordered_trades:
        ccy = (t.ticker_rel.currency if t.ticker_rel else None) or base
        start = t.date_ordered or t.date_planned
        inv_native = t.amount or (t.entry_price * t.units)
        committed.append(
            _Committed(start, _to_base(db, inv_native, ccy, base, start), None)
        )

    return IrrAnalysis(
        base_currency=base,
        realized=_build_scope(realized_recs, "Portfolio"),
        unrealized=_build_scope(unrealized_recs, "Portfolio"),
        daily=_build_daily(realized_recs, committed),
    )
