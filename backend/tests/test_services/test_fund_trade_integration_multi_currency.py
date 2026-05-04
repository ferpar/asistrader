"""End-to-end multi-currency tests through trade lifecycle.

Verifies that when a foreign-currency trade goes order → open → close, the
fund-event chain (reserve → void + benefit/loss) produces a correctly
converted equity delta in the user's base currency.
"""

from datetime import date

import pytest
from sqlalchemy.orm import Session

from asistrader.models.db import (
    Bias,
    FundEvent,
    FundEventType,
    FxRate,
    Strategy,
    Ticker,
    TradeStatus,
    User,
    UserFundSettings,
)
from asistrader.services.fund_service import compute_balance, create_deposit
from asistrader.services.trade_service import create_trade, update_trade


@pytest.fixture
def eur_ticker(db_session: Session, sample_strategy: Strategy) -> Ticker:
    """Ticker explicitly priced in EUR (e.g., MTS.MC)."""
    ticker = Ticker(
        symbol="MTS.MC",
        name="ArcelorMittal",
        currency="EUR",
        bias=Bias.LONG,
        horizon="swing",
        strategy_id=sample_strategy.id,
    )
    db_session.add(ticker)
    db_session.commit()
    return ticker


@pytest.fixture
def fx_eur_history(db_session: Session) -> None:
    """Seed EUR/USD rates for every date the trade lifecycle touches.

    Rates change over the trade's life so we can prove that *each event uses
    its own date's rate* rather than today's.
    """
    db_session.add_all([
        FxRate(currency="EUR", date=date(2026, 4, 1), rate_to_usd=1.10),    # plan
        FxRate(currency="EUR", date=date(2026, 4, 15), rate_to_usd=1.12),   # order
        FxRate(currency="EUR", date=date(2026, 4, 20), rate_to_usd=1.13),   # open
        FxRate(currency="EUR", date=date(2026, 4, 30), rate_to_usd=1.20),   # close (rate moved!)
        FxRate(currency="EUR", date=date.today(), rate_to_usd=1.15),
    ])
    db_session.commit()


@pytest.fixture
def usd_funded_user(
    db_session: Session, sample_user: User
) -> User:
    """Sample user with $20,000 USD deposited and risk_pct loosened for tests."""
    create_deposit(db_session, sample_user.id, 20000.0)
    settings = (
        db_session.query(UserFundSettings)
        .filter(UserFundSettings.user_id == sample_user.id)
        .first()
    )
    if settings is None:
        settings = UserFundSettings(user_id=sample_user.id, risk_pct=0.5)
        db_session.add(settings)
    else:
        settings.risk_pct = 0.5
    db_session.commit()
    return sample_user


def _open_eur_trade_at_100(
    db_session: Session, ticker: Ticker, user: User
):
    """Create + order + open: 50 units at €100 each."""
    trade = create_trade(
        db_session,
        ticker=ticker.symbol,
        entry_price=100.0,
        units=50,
        date_planned=date(2026, 4, 15),
        stop_loss=95.0,
        take_profit=120.0,
        user_id=user.id,
    )
    update_trade(db_session, trade.id, status=TradeStatus.ORDERED)
    update_trade(
        db_session,
        trade.id,
        status=TradeStatus.OPEN,
        date_actual=date(2026, 4, 20),
    )
    return trade


class TestTradeCloseInEur:
    def test_winning_close_creates_eur_benefit_event(
        self,
        db_session: Session,
        eur_ticker: Ticker,
        usd_funded_user: User,
        fx_eur_history: None,
    ):
        trade = _open_eur_trade_at_100(db_session, eur_ticker, usd_funded_user)

        # Close at €120: profit = (120 - 100) × 50 = €1000
        update_trade(
            db_session,
            trade.id,
            status=TradeStatus.CLOSE,
            exit_price=120.0,
            exit_type="tp",
            exit_date=date(2026, 4, 30),
        )

        benefit = (
            db_session.query(FundEvent)
            .filter(
                FundEvent.trade_id == trade.id,
                FundEvent.event_type == FundEventType.BENEFIT,
                FundEvent.voided == False,  # noqa: E712
            )
            .one()
        )
        assert benefit.amount == pytest.approx(1000.0)
        assert benefit.currency == "EUR"
        assert benefit.event_date == date(2026, 4, 30)

    def test_losing_close_creates_eur_loss_event(
        self,
        db_session: Session,
        eur_ticker: Ticker,
        usd_funded_user: User,
        fx_eur_history: None,
    ):
        trade = _open_eur_trade_at_100(db_session, eur_ticker, usd_funded_user)

        # Close at €90: loss = (90 - 100) × 50 = -€500
        update_trade(
            db_session,
            trade.id,
            status=TradeStatus.CLOSE,
            exit_price=90.0,
            exit_type="sl",
            exit_date=date(2026, 4, 30),
        )

        loss = (
            db_session.query(FundEvent)
            .filter(
                FundEvent.trade_id == trade.id,
                FundEvent.event_type == FundEventType.LOSS,
                FundEvent.voided == False,  # noqa: E712
            )
            .one()
        )
        assert loss.amount == pytest.approx(500.0)
        assert loss.currency == "EUR"

    def test_equity_delta_uses_close_day_fx_not_today(
        self,
        db_session: Session,
        eur_ticker: Ticker,
        usd_funded_user: User,
        fx_eur_history: None,
    ):
        """Closing on 2026-04-30 (rate 1.20) should change equity by
        €1000 × 1.20 = $1200, NOT €1000 × today's rate."""
        equity_before = compute_balance(db_session, usd_funded_user.id)["equity"]

        trade = _open_eur_trade_at_100(db_session, eur_ticker, usd_funded_user)
        update_trade(
            db_session,
            trade.id,
            status=TradeStatus.CLOSE,
            exit_price=120.0,
            exit_type="tp",
            exit_date=date(2026, 4, 30),
        )

        equity_after = compute_balance(db_session, usd_funded_user.id)["equity"]
        delta = equity_after - equity_before
        assert delta == pytest.approx(1200.0)

    def test_close_voids_reserve_so_committed_returns_to_zero(
        self,
        db_session: Session,
        eur_ticker: Ticker,
        usd_funded_user: User,
        fx_eur_history: None,
    ):
        trade = _open_eur_trade_at_100(db_session, eur_ticker, usd_funded_user)

        # While open: reserve of €5000 (50 × €100) at rate 1.12 = $5600 committed.
        balance_open = compute_balance(db_session, usd_funded_user.id)
        assert balance_open["committed"] == pytest.approx(5600.0)

        update_trade(
            db_session,
            trade.id,
            status=TradeStatus.CLOSE,
            exit_price=120.0,
            exit_type="tp",
            exit_date=date(2026, 4, 30),
        )

        balance_closed = compute_balance(db_session, usd_funded_user.id)
        assert balance_closed["committed"] == pytest.approx(0.0)

    def test_reopen_restores_reserve_and_voids_benefit(
        self,
        db_session: Session,
        eur_ticker: Ticker,
        usd_funded_user: User,
        fx_eur_history: None,
    ):
        from asistrader.services.trade_service import reopen_trade

        trade = _open_eur_trade_at_100(db_session, eur_ticker, usd_funded_user)
        update_trade(
            db_session,
            trade.id,
            status=TradeStatus.CLOSE,
            exit_price=120.0,
            exit_type="tp",
            exit_date=date(2026, 4, 30),
        )

        reopen_trade(db_session, trade.id)

        # Active benefit voided; reserve un-voided.
        active_benefits = (
            db_session.query(FundEvent)
            .filter(
                FundEvent.trade_id == trade.id,
                FundEvent.event_type == FundEventType.BENEFIT,
                FundEvent.voided == False,  # noqa: E712
            )
            .count()
        )
        active_reserves = (
            db_session.query(FundEvent)
            .filter(
                FundEvent.trade_id == trade.id,
                FundEvent.event_type == FundEventType.RESERVE,
                FundEvent.voided == False,  # noqa: E712
            )
            .count()
        )
        assert active_benefits == 0
        assert active_reserves == 1

        # Equity returns to pre-close shape: only reserve is committed.
        balance = compute_balance(db_session, usd_funded_user.id)
        assert balance["committed"] == pytest.approx(5600.0)
