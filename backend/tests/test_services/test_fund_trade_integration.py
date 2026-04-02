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


def test_create_trade_creates_reserve(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Creating a trade should create a reserve event."""
    create_deposit(db_session, sample_user.id, 10000.0)
    update_risk_pct(db_session, sample_user.id, 0.5)  # Allow larger trades

    trade = create_trade(
        db_session,
        ticker=sample_ticker.symbol,
        entry_price=100.0,
        units=10,
        date_planned=date(2025, 1, 15),
        stop_loss=95.0,
        take_profit=110.0,
        user_id=sample_user.id,
    )

    # Verify reserve event was created
    reserves = (
        db_session.query(FundEvent)
        .filter(
            FundEvent.trade_id == trade.id,
            FundEvent.event_type == FundEventType.RESERVE,
        )
        .all()
    )
    assert len(reserves) == 1
    assert reserves[0].amount == 1000.0  # 100 * 10
    assert reserves[0].voided is False

    # Verify balance
    balance = compute_balance(db_session, sample_user.id)
    assert balance["committed"] == 1000.0
    assert balance["available"] == 9000.0


def test_create_trade_blocked_by_risk_limit(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Creating a trade exceeding risk limit should be blocked."""
    create_deposit(db_session, sample_user.id, 10000.0)
    # Default risk_pct=0.02, max_per_trade=200

    with pytest.raises(FundError, match="exceeds max per trade"):
        create_trade(
            db_session,
            ticker=sample_ticker.symbol,
            entry_price=100.0,
            units=10,  # amount=1000, exceeds 200
            date_planned=date(2025, 1, 15),
            stop_loss=95.0,
            take_profit=110.0,
            user_id=sample_user.id,
        )


def test_cancel_trade_voids_reserve(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Canceling a trade should void its reserve event."""
    create_deposit(db_session, sample_user.id, 10000.0)
    update_risk_pct(db_session, sample_user.id, 0.5)

    trade = create_trade(
        db_session,
        ticker=sample_ticker.symbol,
        entry_price=100.0,
        units=10,
        date_planned=date(2025, 1, 15),
        stop_loss=95.0,
        take_profit=110.0,
        user_id=sample_user.id,
    )

    # Cancel the trade
    update_trade(
        db_session, trade.id,
        status=TradeStatus.CANCELED,
        cancel_reason="input_error",
    )

    # Verify reserve is voided
    reserve = (
        db_session.query(FundEvent)
        .filter(
            FundEvent.trade_id == trade.id,
            FundEvent.event_type == FundEventType.RESERVE,
        )
        .first()
    )
    assert reserve.voided is True

    # Balance should be fully restored
    balance = compute_balance(db_session, sample_user.id)
    assert balance["committed"] == 0.0
    assert balance["available"] == 10000.0


def test_close_trade_with_profit(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Closing a trade with profit should void reserve and create benefit."""
    create_deposit(db_session, sample_user.id, 10000.0)
    update_risk_pct(db_session, sample_user.id, 0.5)

    trade = create_trade(
        db_session,
        ticker=sample_ticker.symbol,
        entry_price=100.0,
        units=10,
        date_planned=date(2025, 1, 15),
        stop_loss=95.0,
        take_profit=115.0,
        user_id=sample_user.id,
    )

    # Open the trade
    update_trade(db_session, trade.id, status=TradeStatus.OPEN)

    # Close with profit (exit at 110, profit = (110-100)*10 = 100)
    update_trade(
        db_session, trade.id,
        status=TradeStatus.CLOSE,
        exit_price=110.0,
        exit_type="tp",
    )

    # Verify reserve is voided
    reserve = (
        db_session.query(FundEvent)
        .filter(
            FundEvent.trade_id == trade.id,
            FundEvent.event_type == FundEventType.RESERVE,
        )
        .first()
    )
    assert reserve.voided is True

    # Verify benefit event was created
    benefit = (
        db_session.query(FundEvent)
        .filter(
            FundEvent.trade_id == trade.id,
            FundEvent.event_type == FundEventType.BENEFIT,
        )
        .first()
    )
    assert benefit is not None
    assert benefit.amount == 100.0

    # Verify balance: 10000 + 100 profit
    balance = compute_balance(db_session, sample_user.id)
    assert balance["equity"] == 10100.0
    assert balance["committed"] == 0.0


def test_close_trade_with_loss(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Closing a trade with loss should void reserve and create loss event."""
    create_deposit(db_session, sample_user.id, 10000.0)
    update_risk_pct(db_session, sample_user.id, 0.5)

    trade = create_trade(
        db_session,
        ticker=sample_ticker.symbol,
        entry_price=100.0,
        units=10,
        date_planned=date(2025, 1, 15),
        stop_loss=95.0,
        take_profit=115.0,
        user_id=sample_user.id,
    )

    update_trade(db_session, trade.id, status=TradeStatus.OPEN)

    # Close with loss (exit at 95, loss = (95-100)*10 = -50)
    update_trade(
        db_session, trade.id,
        status=TradeStatus.CLOSE,
        exit_price=95.0,
        exit_type="sl",
    )

    # Verify loss event
    loss = (
        db_session.query(FundEvent)
        .filter(
            FundEvent.trade_id == trade.id,
            FundEvent.event_type == FundEventType.LOSS,
        )
        .first()
    )
    assert loss is not None
    assert loss.amount == 50.0

    # Verify balance: 10000 - 50 loss
    balance = compute_balance(db_session, sample_user.id)
    assert balance["equity"] == 9950.0


def test_paper_trade_creates_paper_reserve(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Paper trade should create a reserve event with paper_trade=True."""
    create_deposit(db_session, sample_user.id, 10000.0)
    update_risk_pct(db_session, sample_user.id, 0.5)

    trade = create_trade(
        db_session,
        ticker=sample_ticker.symbol,
        entry_price=100.0,
        units=10,
        date_planned=date(2025, 1, 15),
        stop_loss=95.0,
        take_profit=115.0,
        user_id=sample_user.id,
        paper_trade=True,
    )

    reserve = (
        db_session.query(FundEvent)
        .filter(FundEvent.trade_id == trade.id, FundEvent.event_type == FundEventType.RESERVE)
        .first()
    )
    assert reserve.paper_trade is True

    # Paper reserve excluded from default balance
    balance = compute_balance(db_session, sample_user.id, include_paper=False)
    assert balance["committed"] == 0.0

    # Included when include_paper=True
    balance_with_paper = compute_balance(db_session, sample_user.id, include_paper=True)
    assert balance_with_paper["committed"] == 1000.0
