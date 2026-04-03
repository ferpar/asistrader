"""Tests for fund-trade integration."""

from datetime import date

import pytest
from sqlalchemy.orm import Session

from asistrader.models.db import FundEvent, FundEventType, Ticker, Trade, TradeStatus, User
from asistrader.services.fund_service import (
    FundError,
    compute_balance,
    create_deposit,
    update_risk_pct,
)
from asistrader.services.trade_service import TradeUpdateError, create_trade, update_trade


def _create_plan_trade(db_session, ticker, user, auto_detect=False):
    """Helper: create a plan-phase trade (no fund events)."""
    return create_trade(
        db_session,
        ticker=ticker.symbol,
        entry_price=100.0,
        units=10,
        date_planned=date(2025, 1, 15),
        stop_loss=95.0,
        take_profit=115.0,
        user_id=user.id,
        auto_detect=auto_detect,
    )


def test_plan_trade_has_no_reserve(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Creating a plan trade should NOT create a reserve event."""
    create_deposit(db_session, sample_user.id, 10000.0)
    trade = _create_plan_trade(db_session, sample_ticker, sample_user)

    reserves = (
        db_session.query(FundEvent)
        .filter(FundEvent.trade_id == trade.id, FundEvent.event_type == FundEventType.RESERVE)
        .all()
    )
    assert len(reserves) == 0

    balance = compute_balance(db_session, sample_user.id)
    assert balance["committed"] == 0.0
    assert balance["available"] == 10000.0


def test_ordering_trade_creates_reserve(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Transitioning plan→ordered should create a reserve event."""
    create_deposit(db_session, sample_user.id, 10000.0)
    update_risk_pct(db_session, sample_user.id, 0.5)
    trade = _create_plan_trade(db_session, sample_ticker, sample_user)

    update_trade(db_session, trade.id, status=TradeStatus.ORDERED)

    reserves = (
        db_session.query(FundEvent)
        .filter(FundEvent.trade_id == trade.id, FundEvent.event_type == FundEventType.RESERVE)
        .all()
    )
    assert len(reserves) == 1
    assert reserves[0].amount == 1000.0
    assert reserves[0].voided is False

    balance = compute_balance(db_session, sample_user.id)
    assert balance["committed"] == 1000.0
    assert balance["available"] == 9000.0


def test_retracting_ordered_trade_voids_reserve(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Retracting ordered→plan should void the reserve event."""
    create_deposit(db_session, sample_user.id, 10000.0)
    update_risk_pct(db_session, sample_user.id, 0.5)
    trade = _create_plan_trade(db_session, sample_ticker, sample_user)

    update_trade(db_session, trade.id, status=TradeStatus.ORDERED)
    update_trade(db_session, trade.id, status=TradeStatus.PLAN)

    reserve = (
        db_session.query(FundEvent)
        .filter(FundEvent.trade_id == trade.id, FundEvent.event_type == FundEventType.RESERVE)
        .first()
    )
    assert reserve.voided is True

    balance = compute_balance(db_session, sample_user.id)
    assert balance["committed"] == 0.0
    assert balance["available"] == 10000.0


def test_direct_open_non_paper_creates_reserve(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Directly opening a non-paper plan trade should create a reserve."""
    create_deposit(db_session, sample_user.id, 10000.0)
    update_risk_pct(db_session, sample_user.id, 0.5)
    trade = _create_plan_trade(db_session, sample_ticker, sample_user)

    update_trade(db_session, trade.id, status=TradeStatus.OPEN)

    reserves = (
        db_session.query(FundEvent)
        .filter(FundEvent.trade_id == trade.id, FundEvent.event_type == FundEventType.RESERVE)
        .all()
    )
    assert len(reserves) == 1
    assert reserves[0].voided is False


def test_direct_open_auto_detect_creates_reserve(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Directly opening an auto_detect trade DOES create a reserve (same as non-auto_detect)."""
    create_deposit(db_session, sample_user.id, 10000.0)
    update_risk_pct(db_session, sample_user.id, 0.5)
    trade = _create_plan_trade(db_session, sample_ticker, sample_user, auto_detect=True)

    update_trade(db_session, trade.id, status=TradeStatus.OPEN)

    reserves = (
        db_session.query(FundEvent)
        .filter(FundEvent.trade_id == trade.id, FundEvent.event_type == FundEventType.RESERVE)
        .all()
    )
    assert len(reserves) == 1


def test_cancel_ordered_trade_voids_reserve(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Canceling an ordered trade should void its reserve."""
    create_deposit(db_session, sample_user.id, 10000.0)
    update_risk_pct(db_session, sample_user.id, 0.5)
    trade = _create_plan_trade(db_session, sample_ticker, sample_user)

    update_trade(db_session, trade.id, status=TradeStatus.ORDERED)
    update_trade(
        db_session, trade.id,
        status=TradeStatus.CANCELED,
        cancel_reason="input_error",
    )

    reserve = (
        db_session.query(FundEvent)
        .filter(FundEvent.trade_id == trade.id, FundEvent.event_type == FundEventType.RESERVE)
        .first()
    )
    assert reserve.voided is True

    balance = compute_balance(db_session, sample_user.id)
    assert balance["committed"] == 0.0


def test_close_trade_with_profit(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Closing a trade with profit should void reserve and create benefit."""
    create_deposit(db_session, sample_user.id, 10000.0)
    update_risk_pct(db_session, sample_user.id, 0.5)
    trade = _create_plan_trade(db_session, sample_ticker, sample_user)

    update_trade(db_session, trade.id, status=TradeStatus.ORDERED)
    update_trade(db_session, trade.id, status=TradeStatus.OPEN)
    update_trade(
        db_session, trade.id,
        status=TradeStatus.CLOSE,
        exit_price=110.0,
        exit_type="tp",
    )

    reserve = (
        db_session.query(FundEvent)
        .filter(FundEvent.trade_id == trade.id, FundEvent.event_type == FundEventType.RESERVE)
        .first()
    )
    assert reserve.voided is True

    benefit = (
        db_session.query(FundEvent)
        .filter(FundEvent.trade_id == trade.id, FundEvent.event_type == FundEventType.BENEFIT)
        .first()
    )
    assert benefit is not None
    assert benefit.amount == 100.0  # (110-100)*10

    balance = compute_balance(db_session, sample_user.id)
    assert balance["equity"] == 10100.0
    assert balance["committed"] == 0.0


def test_close_trade_with_loss(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Closing a trade with loss should void reserve and create loss event."""
    create_deposit(db_session, sample_user.id, 10000.0)
    update_risk_pct(db_session, sample_user.id, 0.5)
    trade = _create_plan_trade(db_session, sample_ticker, sample_user)

    update_trade(db_session, trade.id, status=TradeStatus.ORDERED)
    update_trade(db_session, trade.id, status=TradeStatus.OPEN)
    update_trade(
        db_session, trade.id,
        status=TradeStatus.CLOSE,
        exit_price=95.0,
        exit_type="sl",
    )

    loss = (
        db_session.query(FundEvent)
        .filter(FundEvent.trade_id == trade.id, FundEvent.event_type == FundEventType.LOSS)
        .first()
    )
    assert loss is not None
    assert loss.amount == 50.0  # (100-95)*10

    balance = compute_balance(db_session, sample_user.id)
    assert balance["equity"] == 9950.0


# --- Backend fund enforcement tests ---


def test_ordering_without_funds_blocked_by_backend(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Ordering a trade with no funds should be blocked by backend."""
    trade = _create_plan_trade(db_session, sample_ticker, sample_user)

    with pytest.raises(FundError, match="No funds available"):
        update_trade(db_session, trade.id, status=TradeStatus.ORDERED)

    # Trade should still be in plan status (check wasn't committed)
    db_session.refresh(trade)
    assert trade.status == TradeStatus.PLAN


def test_ordering_exceeds_risk_blocked_by_backend(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Ordering a trade exceeding risk limit should be blocked by backend."""
    create_deposit(db_session, sample_user.id, 10000.0)
    # Default risk_pct=0.02, max_per_trade=200, trade amount=1000
    trade = _create_plan_trade(db_session, sample_ticker, sample_user)

    with pytest.raises(FundError, match="exceeds max per trade"):
        update_trade(db_session, trade.id, status=TradeStatus.ORDERED)

    db_session.refresh(trade)
    assert trade.status == TradeStatus.PLAN


def test_direct_open_without_funds_blocked_by_backend(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Directly opening a non-paper trade with no funds should be blocked."""
    trade = _create_plan_trade(db_session, sample_ticker, sample_user)

    with pytest.raises(FundError, match="No funds available"):
        update_trade(db_session, trade.id, status=TradeStatus.OPEN)

    db_session.refresh(trade)
    assert trade.status == TradeStatus.PLAN
