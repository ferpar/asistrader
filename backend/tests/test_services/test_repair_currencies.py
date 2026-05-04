"""Tests for repair_trade_event_currencies — the legacy currency fixer.

Background: pre-migration-015 fund events had no currency; after 015 they
default to 'USD'. Trade-linked events on EUR/GBP/etc tickers are wrongly
tagged. This service syncs them to the ticker currency.
"""

from datetime import date, datetime, timezone

import pytest
from sqlalchemy.orm import Session

from asistrader.models.db import (
    Bias,
    FundEvent,
    FundEventType,
    Strategy,
    Ticker,
    Trade,
    TradeStatus,
    User,
)
from asistrader.services.fund_service import repair_trade_event_currencies


@pytest.fixture
def eur_ticker(db_session: Session, sample_strategy: Strategy) -> Ticker:
    ticker = Ticker(
        symbol="MTS.MC",
        currency="EUR",
        bias=Bias.LONG,
        horizon="swing",
        strategy_id=sample_strategy.id,
    )
    db_session.add(ticker)
    db_session.commit()
    return ticker


@pytest.fixture
def usd_ticker(db_session: Session, sample_strategy: Strategy) -> Ticker:
    ticker = Ticker(
        symbol="NVDA",
        currency="USD",
        bias=Bias.LONG,
        horizon="swing",
        strategy_id=sample_strategy.id,
    )
    db_session.add(ticker)
    db_session.commit()
    return ticker


@pytest.fixture
def untagged_ticker(db_session: Session, sample_strategy: Strategy) -> Ticker:
    """Ticker without a currency set (legacy ticker, edge case)."""
    ticker = Ticker(
        symbol="OLD",
        currency=None,
        bias=Bias.LONG,
        horizon="swing",
        strategy_id=sample_strategy.id,
    )
    db_session.add(ticker)
    db_session.commit()
    return ticker


def _legacy_trade(
    db_session: Session, ticker: Ticker, user: User, trade_id: int = 1
) -> Trade:
    trade = Trade(
        id=trade_id,
        ticker=ticker.symbol,
        status=TradeStatus.OPEN,
        amount=10000.0,
        units=100,
        entry_price=100.0,
        date_planned=date(2025, 1, 15),
        date_actual=date(2025, 1, 16),
        user_id=user.id,
    )
    db_session.add(trade)
    db_session.commit()
    return trade


def _legacy_event(
    db_session: Session,
    user: User,
    event_type: FundEventType,
    trade: Trade | None,
    *,
    currency: str = "USD",
    voided: bool = False,
) -> FundEvent:
    """Insert an event the way migration 015 left legacy rows: amount + USD tag."""
    event = FundEvent(
        user_id=user.id,
        event_type=event_type,
        amount=1000.0,
        currency=currency,
        trade_id=trade.id if trade else None,
        event_date=date(2025, 1, 16),
        voided=voided,
        voided_at=datetime.now(timezone.utc) if voided else None,
    )
    db_session.add(event)
    db_session.commit()
    return event


class TestRepairTradeEventCurrencies:
    def test_repairs_reserve_on_eur_trade(
        self, db_session: Session, sample_user: User, eur_ticker: Ticker
    ):
        trade = _legacy_trade(db_session, eur_ticker, sample_user)
        event = _legacy_event(db_session, sample_user, FundEventType.RESERVE, trade)

        result = repair_trade_event_currencies(db_session)

        assert result == {"reserve": 1}
        db_session.refresh(event)
        assert event.currency == "EUR"

    def test_repairs_benefit_and_loss(
        self, db_session: Session, sample_user: User, eur_ticker: Ticker
    ):
        trade = _legacy_trade(db_session, eur_ticker, sample_user)
        _legacy_event(db_session, sample_user, FundEventType.BENEFIT, trade)
        _legacy_event(db_session, sample_user, FundEventType.LOSS, trade)

        result = repair_trade_event_currencies(db_session)

        assert result == {"benefit": 1, "loss": 1}
        currencies = {
            e.currency
            for e in db_session.query(FundEvent)
            .filter(FundEvent.trade_id == trade.id)
            .all()
        }
        assert currencies == {"EUR"}

    def test_idempotent_when_already_tagged(
        self, db_session: Session, sample_user: User, eur_ticker: Ticker
    ):
        """Already-correct EUR-tagged events are not touched."""
        trade = _legacy_trade(db_session, eur_ticker, sample_user)
        _legacy_event(
            db_session, sample_user, FundEventType.RESERVE, trade, currency="EUR"
        )

        result = repair_trade_event_currencies(db_session)
        assert result == {}

    def test_leaves_deposits_and_withdrawals_alone(
        self, db_session: Session, sample_user: User
    ):
        """Deposits/withdrawals (no trade_id) stay USD even on a user with EUR trades."""
        _legacy_event(db_session, sample_user, FundEventType.DEPOSIT, trade=None)
        _legacy_event(db_session, sample_user, FundEventType.WITHDRAWAL, trade=None)

        result = repair_trade_event_currencies(db_session)
        assert result == {}

        currencies = {
            e.currency
            for e in db_session.query(FundEvent).all()
        }
        assert currencies == {"USD"}

    def test_leaves_usd_trades_alone(
        self, db_session: Session, sample_user: User, usd_ticker: Ticker
    ):
        """No-op when the trade's ticker is genuinely USD."""
        trade = _legacy_trade(db_session, usd_ticker, sample_user)
        event = _legacy_event(db_session, sample_user, FundEventType.RESERVE, trade)

        result = repair_trade_event_currencies(db_session)
        assert result == {}
        db_session.refresh(event)
        assert event.currency == "USD"

    def test_skips_trade_with_null_ticker_currency(
        self,
        db_session: Session,
        sample_user: User,
        untagged_ticker: Ticker,
    ):
        """Trades whose ticker has no currency set are skipped — no crash."""
        trade = _legacy_trade(db_session, untagged_ticker, sample_user)
        event = _legacy_event(db_session, sample_user, FundEventType.RESERVE, trade)

        result = repair_trade_event_currencies(db_session)
        assert result == {}
        db_session.refresh(event)
        assert event.currency == "USD"

    def test_repairs_voided_events_too(
        self, db_session: Session, sample_user: User, eur_ticker: Ticker
    ):
        """Voided events still need correct currency for reopen flows."""
        trade = _legacy_trade(db_session, eur_ticker, sample_user)
        event = _legacy_event(
            db_session, sample_user, FundEventType.RESERVE, trade, voided=True
        )

        result = repair_trade_event_currencies(db_session)
        assert result == {"reserve": 1}
        db_session.refresh(event)
        assert event.currency == "EUR"

    def test_user_id_filter_repairs_only_that_user(
        self,
        db_session: Session,
        sample_user: User,
        eur_ticker: Ticker,
    ):
        # Second user with their own EUR trade & legacy reserve.
        from asistrader.auth.password import hash_password

        other_user = User(
            id=2,
            email="other@example.com",
            hashed_password=hash_password("pw"),
            is_active=True,
        )
        db_session.add(other_user)
        db_session.commit()

        my_trade = _legacy_trade(db_session, eur_ticker, sample_user, trade_id=10)
        their_trade = _legacy_trade(db_session, eur_ticker, other_user, trade_id=11)

        my_event = _legacy_event(
            db_session, sample_user, FundEventType.RESERVE, my_trade
        )
        their_event = _legacy_event(
            db_session, other_user, FundEventType.RESERVE, their_trade
        )

        result = repair_trade_event_currencies(db_session, user_id=sample_user.id)

        assert result == {"reserve": 1}
        db_session.refresh(my_event)
        db_session.refresh(their_event)
        assert my_event.currency == "EUR"
        assert their_event.currency == "USD"  # untouched
