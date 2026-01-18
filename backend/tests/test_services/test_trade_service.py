"""Tests for the trade service."""

from datetime import date

from sqlalchemy.orm import Session

from asistrader.models.db import Ticker, Trade, TradeStatus
from asistrader.services.trade_service import get_all_trades, get_trade_by_id


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
