"""Tests for the trades API endpoints."""

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from asistrader.models.db import Ticker, Trade, TradeStatus


def test_list_trades_empty(client: TestClient) -> None:
    """Test listing trades when database is empty."""
    response = client.get("/api/trades")
    assert response.status_code == 200
    data = response.json()
    assert data["trades"] == []
    assert data["count"] == 0


def test_list_trades_with_data(
    client: TestClient, db_session: Session, sample_ticker: Ticker, sample_trade: Trade
) -> None:
    """Test listing trades with data in database."""
    response = client.get("/api/trades")
    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 1
    assert len(data["trades"]) == 1

    trade = data["trades"][0]
    assert trade["id"] == 1
    assert trade["ticker"] == "ASML"
    assert trade["status"] == "open"
    assert trade["amount"] == 1000.0
    assert trade["units"] == 10
    assert trade["entry_price"] == 100.0
    assert trade["stop_loss"] == 95.0
    assert trade["take_profit"] == 115.0


def test_list_trades_calculated_fields(
    client: TestClient, db_session: Session, sample_ticker: Ticker, sample_trade: Trade
) -> None:
    """Test that calculated fields are returned correctly."""
    response = client.get("/api/trades")
    assert response.status_code == 200
    data = response.json()

    trade = data["trades"][0]
    # risk_abs = (stop_loss - entry_price) * units = (95 - 100) * 10 = -50
    assert trade["risk_abs"] == -50.0
    # profit_abs = (take_profit - entry_price) * units = (115 - 100) * 10 = 150
    assert trade["profit_abs"] == 150.0


def test_list_trades_multiple(client: TestClient, db_session: Session) -> None:
    """Test listing multiple trades."""
    # Create tickers
    ticker1 = Ticker(symbol="ASML", name="ASML Holding")
    ticker2 = Ticker(symbol="NVDA", name="NVIDIA")
    db_session.add_all([ticker1, ticker2])
    db_session.commit()

    # Create trades
    trade1 = Trade(
        id=1,
        ticker="ASML",
        status=TradeStatus.OPEN,
        amount=1000.0,
        units=10,
        entry_price=100.0,
        stop_loss=95.0,
        take_profit=115.0,
        date_planned=date(2025, 1, 15),
    )
    trade2 = Trade(
        id=2,
        ticker="NVDA",
        status=TradeStatus.PLAN,
        amount=2000.0,
        units=5,
        entry_price=200.0,
        stop_loss=190.0,
        take_profit=230.0,
        date_planned=date(2025, 1, 16),
    )
    db_session.add_all([trade1, trade2])
    db_session.commit()

    response = client.get("/api/trades")
    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 2
    assert len(data["trades"]) == 2


def test_health_check(client: TestClient) -> None:
    """Test the health check endpoint."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}
