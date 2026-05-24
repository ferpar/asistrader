"""Tests for irr_service — the Drivers / IRR analysis.

The integration test reproduces the worked example shipped in
`IRR-Examples.numbers` (Day 1, tickers A/B/C) so the spreadsheet doubles as a
regression fixture.
"""

from datetime import date, timedelta

import pytest

from asistrader.models.db import FxRate, Ticker, Trade, TradeStatus, User
from asistrader.services import irr_service
from asistrader.services.irr_service import (
    _holding_days,
    _simple_tir,
    _two_flow_xirr,
    _xirr,
    compute_analysis,
)


# ── Pure helpers ──────────────────────────────────────────────────────────


def test_holding_days_basic():
    assert _holding_days(date(2025, 1, 16), date(2025, 1, 31)) == 15


def test_holding_days_clamped_to_one():
    # Same-day (or reversed) trades never produce a zero denominator.
    assert _holding_days(date(2025, 1, 16), date(2025, 1, 16)) == 1
    assert _holding_days(date(2025, 1, 20), date(2025, 1, 16)) == 1


def test_simple_tir_matches_spreadsheet():
    # Ticker A: 75 profit on 2310 invested over 15 days -> 79.00%.
    assert _simple_tir(75 / 2310, 15) == pytest.approx(0.7900, abs=1e-4)
    # Ticker B: 50 / 2310 over 18 days -> 43.89%.
    assert _simple_tir(50 / 2310, 18) == pytest.approx(0.4389, abs=1e-4)
    # Ticker C: 10 / 2310 over 25 days -> 6.32%.
    assert _simple_tir(10 / 2310, 25) == pytest.approx(0.0632, abs=1e-4)


def test_two_flow_xirr_closed_form():
    # Compound rate solving (1+r)^(15/365) = 2385/2310.
    r = _two_flow_xirr(2310, 2385, 15)
    assert r is not None
    assert (1 + r) ** (15 / 365) == pytest.approx(2385 / 2310, rel=1e-9)


def test_two_flow_xirr_undefined_when_wiped_out():
    assert _two_flow_xirr(2310, 0, 15) is None
    assert _two_flow_xirr(0, 100, 15) is None


def test_xirr_matches_two_flow_closed_form():
    d0 = date(2025, 1, 1)
    numeric = _xirr([(d0, -2310.0), (d0 + timedelta(days=15), 2385.0)])
    closed = _two_flow_xirr(2310, 2385, 15)
    assert numeric == pytest.approx(closed, rel=1e-4)


def test_xirr_none_without_sign_change():
    d0 = date(2025, 1, 1)
    assert _xirr([(d0, -100.0), (d0 + timedelta(days=10), -50.0)]) is None


# ── Integration: the IRR-Examples.numbers worked example ──────────────────


@pytest.fixture
def spreadsheet_scenario(db_session, sample_user: User) -> date:
    """Recreate Day 1 of the spreadsheet: 3 closed trades + a 69,300 idle pool.

    Returns the close date D.
    """
    day = date(2025, 3, 1)

    for sym in ("TKA", "TKB", "TKC"):
        db_session.add(Ticker(symbol=sym, name=f"Ticker {sym[-1]}", currency="USD"))

    # Closed trades: (ticker, profit, holding days). Investment 2,310 each.
    closed = [("TKA", 75, 15), ("TKB", 50, 18), ("TKC", 10, 25)]
    for sym, profit, days in closed:
        db_session.add(
            Trade(
                ticker=sym,
                status=TradeStatus.CLOSE,
                amount=2310.0,
                units=1,
                entry_price=2310.0,
                exit_price=2310.0 + profit,
                date_planned=day - timedelta(days=days),
                date_ordered=day - timedelta(days=days),
                exit_date=day,
                user_id=sample_user.id,
            )
        )

    # Idle pool: 50 ordered trades of 1,386 each -> 69,300 committed capital.
    db_session.add(Ticker(symbol="IDLE", name="Idle", currency="USD"))
    for _ in range(50):
        db_session.add(
            Trade(
                ticker="IDLE",
                status=TradeStatus.ORDERED,
                amount=1386.0,
                units=1,
                entry_price=1386.0,
                date_planned=day - timedelta(days=40),
                date_ordered=day - timedelta(days=40),
                user_id=sample_user.id,
            )
        )

    db_session.commit()
    return day


def test_per_trade_tir(db_session, sample_user, spreadsheet_scenario):
    analysis = compute_analysis(db_session, sample_user.id)

    by_ticker = {t.ticker: t for t in analysis.realized.transactions}
    assert by_ticker["TKA"].tir == pytest.approx(0.7900, abs=1e-4)
    assert by_ticker["TKB"].tir == pytest.approx(0.4389, abs=1e-4)
    assert by_ticker["TKC"].tir == pytest.approx(0.0632, abs=1e-4)
    # XIRR (compound) is produced alongside and is larger for fast winners.
    assert by_ticker["TKA"].xirr > by_ticker["TKA"].tir


def test_portfolio_daily_aggregate(db_session, sample_user, spreadsheet_scenario):
    analysis = compute_analysis(db_session, sample_user.id)

    pf = analysis.realized.portfolio
    assert pf is not None
    assert pf.investment_base == pytest.approx(6930.0)
    assert pf.profit_base == pytest.approx(135.0)
    assert pf.avg_holding_days == pytest.approx(19.333, abs=1e-3)
    assert pf.tir == pytest.approx(0.3678, abs=1e-4)


def test_enhanced_daily_metric(db_session, sample_user, spreadsheet_scenario):
    analysis = compute_analysis(db_session, sample_user.id)

    assert len(analysis.daily.mixed) == 1
    point = analysis.daily.mixed[0]
    assert point.investment_base == pytest.approx(6930.0)
    assert point.profit_base == pytest.approx(135.0)
    assert point.tir == pytest.approx(0.3678, abs=1e-4)

    # Enhanced: 69,300 idle pool / 50 trades = 1,386 per slot;
    # denominator 6,930 + 1,386*3 = 11,088; 135 / 11,088 = 1.22%.
    assert point.idle_pool_base == pytest.approx(69300.0)
    assert point.idle_trade_count == 50
    assert point.enhanced_return_pct == pytest.approx(0.012175, abs=1e-5)
    assert point.enhanced_tir is not None


def test_by_ticker_winners_losers_decomposition(db_session, sample_user):
    """A ticker traded repeatedly is split into mixed / winners-only / losers-only.

    Winners and losers of the same ticker must not cross-contaminate.
    """
    db_session.add(Ticker(symbol="MIX", name="Mixed Co", currency="USD"))
    day = date(2025, 4, 1)
    # Two winners (+100, +60) and one loser (-40), all on ticker MIX.
    for profit, days in [(100, 10), (60, 20), (-40, 30)]:
        db_session.add(
            Trade(
                ticker="MIX",
                status=TradeStatus.CLOSE,
                amount=1000.0,
                units=1,
                entry_price=1000.0,
                exit_price=1000.0 + profit,
                date_planned=day - timedelta(days=days),
                date_ordered=day - timedelta(days=days),
                exit_date=day,
                user_id=sample_user.id,
            )
        )
    db_session.commit()

    analysis = compute_analysis(db_session, sample_user.id)
    realized = analysis.realized

    mixed = {g.label: g for g in realized.by_ticker}["MIX"]
    winners = {g.label: g for g in realized.by_ticker_winners}["MIX"]
    losers = {g.label: g for g in realized.by_ticker_losers}["MIX"]

    assert mixed.trade_count == 3
    assert mixed.profit_base == pytest.approx(120.0)  # 100 + 60 - 40

    assert winners.trade_count == 2
    assert winners.profit_base == pytest.approx(160.0)  # uncontaminated by the loser
    assert winners.return_pct > 0

    assert losers.trade_count == 1
    assert losers.profit_base == pytest.approx(-40.0)
    assert losers.return_pct < 0


def test_portfolio_winners_losers_decomposition(db_session, sample_user):
    """Portfolio summary is also offered as winners-only and losers-only slices,
    re-aggregated from the underlying records so TIR/XIRR remain meaningful.
    """
    db_session.add(Ticker(symbol="MIX", name="Mixed Co", currency="USD"))
    day = date(2025, 4, 1)
    for profit, days in [(100, 10), (60, 20), (-40, 30)]:
        db_session.add(
            Trade(
                ticker="MIX",
                status=TradeStatus.CLOSE,
                amount=1000.0,
                units=1,
                entry_price=1000.0,
                exit_price=1000.0 + profit,
                date_planned=day - timedelta(days=days),
                date_ordered=day - timedelta(days=days),
                exit_date=day,
                user_id=sample_user.id,
            )
        )
    db_session.commit()

    realized = compute_analysis(db_session, sample_user.id).realized

    assert realized.portfolio is not None
    assert realized.portfolio.trade_count == 3
    assert realized.portfolio.profit_base == pytest.approx(120.0)

    assert realized.portfolio_winners is not None
    assert realized.portfolio_winners.trade_count == 2
    assert realized.portfolio_winners.profit_base == pytest.approx(160.0)
    assert realized.portfolio_winners.return_pct > 0

    assert realized.portfolio_losers is not None
    assert realized.portfolio_losers.trade_count == 1
    assert realized.portfolio_losers.profit_base == pytest.approx(-40.0)
    assert realized.portfolio_losers.return_pct < 0


def test_portfolio_winners_losers_none_on_empty_scope(db_session, sample_user):
    """An empty scope (no trades) has no portfolio aggregates at all."""
    analysis = compute_analysis(db_session, sample_user.id)
    assert analysis.realized.portfolio is None
    assert analysis.realized.portfolio_winners is None
    assert analysis.realized.portfolio_losers is None


def test_unrealized_scope_marks_at_current_price(
    db_session, sample_user, monkeypatch
):
    """Open trades are marked at the live price for the unrealized scope."""
    db_session.add(Ticker(symbol="OPN", name="Open Co", currency="USD"))
    db_session.add(
        Trade(
            ticker="OPN",
            status=TradeStatus.OPEN,
            amount=1000.0,
            units=10,
            entry_price=100.0,
            date_planned=date(2025, 1, 1),
            date_ordered=date(2025, 1, 1),
            date_actual=date(2025, 1, 2),
            user_id=sample_user.id,
        )
    )
    db_session.commit()

    monkeypatch.setattr(
        irr_service,
        "get_batch_prices",
        lambda symbols, db=None: {"OPN": {"price": 110.0, "currency": "USD", "valid": True}},
    )

    analysis = compute_analysis(db_session, sample_user.id)

    assert len(analysis.unrealized.transactions) == 1
    txn = analysis.unrealized.transactions[0]
    assert txn.profit_native == pytest.approx(100.0)  # (110-100)*10
    assert txn.return_pct == pytest.approx(0.10)
    assert analysis.realized.portfolio is None  # no closed trades


def test_fx_drift_decomposes_base_profit(db_session, sample_user):
    """A trade in a non-base currency exposes how much of profit_base came
    from FX vs the underlying instrument, while the winner classification
    stays anchored to native-currency performance (the actual trade call).
    """
    db_session.add(Ticker(symbol="EUX", name="Euro stock", currency="EUR"))
    start = date(2025, 1, 1)
    end = date(2025, 6, 1)
    # EUR was strong at order, weak at close: a +100 EUR gain still produces
    # a base-currency loss after the rate halves.
    db_session.add(FxRate(currency="EUR", date=start, rate_to_usd=1.50))
    db_session.add(FxRate(currency="EUR", date=end, rate_to_usd=0.50))
    db_session.add(
        Trade(
            ticker="EUX",
            status=TradeStatus.CLOSE,
            amount=1000.0,
            units=10,
            entry_price=100.0,
            exit_price=110.0,  # +10 EUR/unit -> +100 EUR native profit
            date_planned=start,
            date_ordered=start,
            exit_date=end,
            user_id=sample_user.id,
        )
    )
    db_session.commit()

    analysis = compute_analysis(db_session, sample_user.id)

    txn = analysis.realized.transactions[0]
    # Native is what defines the trade outcome: this is a winner.
    assert txn.profit_native == pytest.approx(100.0)
    assert txn.is_winner is True
    # Base values: inv = 1000 * 1.5 = 1500 USD; proceeds = 1100 * 0.5 = 550;
    # profit_base = -950. Pure trading at start FX = 100 * 1.5 = 150; drift
    # is the rest: -950 - 150 = -1100.
    assert txn.investment_base == pytest.approx(1500.0)
    assert txn.profit_base == pytest.approx(-950.0)
    assert txn.fx_drift_base == pytest.approx(-1100.0)
    # The split puts a native-winner on the winners side even when base loses.
    assert {g.label for g in analysis.realized.by_ticker_winners} == {"EUX"}
    assert analysis.realized.by_ticker_losers == []
    # GroupIrr surfaces the per-ticker currency and the summed drift.
    ticker_group = analysis.realized.by_ticker_winners[0]
    assert ticker_group.currency == "EUR"
    assert ticker_group.fx_drift_base == pytest.approx(-1100.0)
    # Portfolio aggregates drift across currencies; its currency stays None.
    pf = analysis.realized.portfolio
    assert pf is not None
    assert pf.currency is None
    assert pf.fx_drift_base == pytest.approx(-1100.0)


def test_fx_drift_is_zero_for_base_currency_trades(db_session, sample_user):
    """Same-currency trades have no FX exposure, so drift is zero."""
    db_session.add(Ticker(symbol="USX", name="USD stock", currency="USD"))
    db_session.add(
        Trade(
            ticker="USX",
            status=TradeStatus.CLOSE,
            amount=1000.0,
            units=10,
            entry_price=100.0,
            exit_price=110.0,
            date_planned=date(2025, 1, 1),
            date_ordered=date(2025, 1, 1),
            exit_date=date(2025, 6, 1),
            user_id=sample_user.id,
        )
    )
    db_session.commit()

    analysis = compute_analysis(db_session, sample_user.id)

    assert analysis.realized.transactions[0].fx_drift_base == 0.0
    assert analysis.realized.by_ticker_winners[0].fx_drift_base == 0.0
    assert analysis.realized.portfolio is not None
    assert analysis.realized.portfolio.fx_drift_base == 0.0
