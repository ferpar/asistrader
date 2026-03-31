"""Tests for the trade service."""

from datetime import date

import pytest
from sqlalchemy.orm import Session

from asistrader.models.db import Ticker, Trade, TradeStatus, User
from asistrader.services.trade_service import get_all_trades, get_trade_by_id, update_trade, TradeUpdateError


def test_get_all_trades_empty(db_session: Session) -> None:
    """Test getting all trades from empty database."""
    trades = get_all_trades(db_session)
    assert trades == []


def test_get_all_trades_with_data(
    db_session: Session, sample_ticker: Ticker, sample_trade: Trade
) -> None:
    """Test getting all trades with data."""
    trades = get_all_trades(db_session)
    assert len(trades) == 1
    assert trades[0].id == sample_trade.id
    assert trades[0].ticker == "ASML"


def test_get_trade_by_id_found(
    db_session: Session, sample_ticker: Ticker, sample_trade: Trade
) -> None:
    """Test getting a trade by ID when it exists."""
    trade = get_trade_by_id(db_session, 1)
    assert trade is not None
    assert trade.id == 1
    assert trade.ticker == "ASML"


def test_get_trade_by_id_not_found(db_session: Session) -> None:
    """Test getting a trade by ID when it doesn't exist."""
    trade = get_trade_by_id(db_session, 999)
    assert trade is None


def test_trade_calculated_properties(
    db_session: Session, sample_ticker: Ticker, sample_trade: Trade
) -> None:
    """Test trade calculated properties."""
    trade = get_trade_by_id(db_session, 1)
    assert trade is not None
    # risk_abs = (stop_loss - entry_price) * units = (95 - 100) * 10 = -50
    assert trade.risk_abs == -50.0
    # profit_abs = (take_profit - entry_price) * units = (115 - 100) * 10 = 150
    assert trade.profit_abs == 150.0


# --- Status transition tests ---


def _create_plan_trade(
    db_session: Session, ticker: Ticker, user: User, paper_trade: bool = False
) -> Trade:
    """Helper to create a plan-status trade for transition tests."""
    trade = Trade(
        ticker=ticker.symbol,
        status=TradeStatus.PLAN,
        amount=1000.0,
        units=10,
        entry_price=100.0,
        date_planned=date(2025, 1, 15),
        user_id=user.id,
        paper_trade=paper_trade,
        remaining_units=10,
    )
    db_session.add(trade)
    db_session.commit()
    return trade


def test_transition_plan_to_ordered(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Test plan → ordered transition for non-paper trade."""
    trade = _create_plan_trade(db_session, sample_ticker, sample_user)
    updated = update_trade(db_session, trade.id, status=TradeStatus.ORDERED)
    assert updated.status == TradeStatus.ORDERED


def test_transition_plan_to_ordered_blocked_for_paper(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Test plan → ordered is blocked for paper trades."""
    trade = _create_plan_trade(db_session, sample_ticker, sample_user, paper_trade=True)
    with pytest.raises(TradeUpdateError, match="Paper trades cannot be ordered"):
        update_trade(db_session, trade.id, status=TradeStatus.ORDERED)


def test_transition_ordered_to_open(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Test ordered → open transition auto-sets date_actual."""
    trade = _create_plan_trade(db_session, sample_ticker, sample_user)
    update_trade(db_session, trade.id, status=TradeStatus.ORDERED)
    updated = update_trade(db_session, trade.id, status=TradeStatus.OPEN)
    assert updated.status == TradeStatus.OPEN
    assert updated.date_actual == date.today()


def test_transition_ordered_to_plan(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Test ordered → plan (cancel order)."""
    trade = _create_plan_trade(db_session, sample_ticker, sample_user)
    update_trade(db_session, trade.id, status=TradeStatus.ORDERED)
    updated = update_trade(db_session, trade.id, status=TradeStatus.PLAN)
    assert updated.status == TradeStatus.PLAN


def test_transition_ordered_to_close_blocked(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Test ordered → close is blocked."""
    trade = _create_plan_trade(db_session, sample_ticker, sample_user)
    update_trade(db_session, trade.id, status=TradeStatus.ORDERED)
    with pytest.raises(TradeUpdateError, match="Cannot close a trade that is not open"):
        update_trade(db_session, trade.id, status=TradeStatus.CLOSE)


def test_transition_plan_to_open_still_works(
    db_session: Session, sample_ticker: Ticker, sample_user: User
) -> None:
    """Test plan → open shortcut still works."""
    trade = _create_plan_trade(db_session, sample_ticker, sample_user)
    updated = update_trade(db_session, trade.id, status=TradeStatus.OPEN)
    assert updated.status == TradeStatus.OPEN
    assert updated.date_actual == date.today()
