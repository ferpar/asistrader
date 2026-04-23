"""Tests for the trades API endpoints."""

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from datetime import date

from asistrader.models.db import ExitLevel, ExitLevelStatus, ExitLevelType, Ticker, Trade, TradeStatus, User


def test_list_trades_empty(
    client: TestClient, auth_headers: dict[str, str], sample_user: User
) -> None:
    """Test listing trades when database is empty."""
    response = client.get("/api/trades", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["trades"] == []
    assert data["count"] == 0


def test_list_trades_with_data(
    client: TestClient,
    db_session: Session,
    sample_ticker: Ticker,
    sample_trade: Trade,
    auth_headers: dict[str, str],
) -> None:
    """Test listing trades with data in database."""
    response = client.get("/api/trades", headers=auth_headers)
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
    # stop_loss and take_profit are now computed from exit_levels
    assert trade["stop_loss"] == 95.0
    assert trade["take_profit"] == 115.0


def test_list_trades_calculated_fields(
    client: TestClient,
    db_session: Session,
    sample_ticker: Ticker,
    sample_trade: Trade,
    auth_headers: dict[str, str],
) -> None:
    """Test that calculated fields are returned correctly."""
    response = client.get("/api/trades", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()

    trade = data["trades"][0]
    # risk_abs = (stop_loss - entry_price) * units = (95 - 100) * 10 = -50
    assert trade["risk_abs"] == -50.0
    # profit_abs = (take_profit - entry_price) * units = (115 - 100) * 10 = 150
    assert trade["profit_abs"] == 150.0


def test_list_trades_multiple(
    client: TestClient, db_session: Session, sample_user: User, auth_headers: dict[str, str]
) -> None:
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
        date_planned=date(2025, 1, 15),
        user_id=sample_user.id,
        remaining_units=10,
    )
    trade2 = Trade(
        id=2,
        ticker="NVDA",
        status=TradeStatus.PLAN,
        amount=2000.0,
        units=5,
        entry_price=200.0,
        date_planned=date(2025, 1, 16),
        user_id=sample_user.id,
        remaining_units=5,
    )
    db_session.add_all([trade1, trade2])
    db_session.commit()

    # Add exit levels for trade1 (SL=95, TP=115)
    trade1_levels = [
        ExitLevel(trade_id=1, level_type=ExitLevelType.SL, price=95.0, units_pct=1.0, order_index=1, status=ExitLevelStatus.PENDING, move_sl_to_breakeven=False),
        ExitLevel(trade_id=1, level_type=ExitLevelType.TP, price=115.0, units_pct=1.0, order_index=1, status=ExitLevelStatus.PENDING, move_sl_to_breakeven=False),
    ]
    # Add exit levels for trade2 (SL=190, TP=230)
    trade2_levels = [
        ExitLevel(trade_id=2, level_type=ExitLevelType.SL, price=190.0, units_pct=1.0, order_index=1, status=ExitLevelStatus.PENDING, move_sl_to_breakeven=False),
        ExitLevel(trade_id=2, level_type=ExitLevelType.TP, price=230.0, units_pct=1.0, order_index=1, status=ExitLevelStatus.PENDING, move_sl_to_breakeven=False),
    ]
    db_session.add_all(trade1_levels + trade2_levels)
    db_session.commit()

    response = client.get("/api/trades", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 2
    assert len(data["trades"]) == 2


def test_list_trades_unauthorized(client: TestClient) -> None:
    """Test that unauthenticated requests are rejected."""
    response = client.get("/api/trades")
    assert response.status_code == 401


def test_health_check(client: TestClient) -> None:
    """Test the health check endpoint."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


def test_order_trade_insufficient_funds_returns_400(
    client: TestClient,
    db_session: Session,
    sample_ticker: Ticker,
    sample_user: User,
    auth_headers: dict[str, str],
) -> None:
    """Ordering a trade without funds returns 400, not 500."""
    # Create a plan trade directly (no fund check on creation)
    trade = Trade(
        ticker=sample_ticker.symbol,
        status=TradeStatus.PLAN,
        amount=1000.0,
        units=10,
        entry_price=100.0,
        date_planned=date(2025, 1, 15),
        user_id=sample_user.id,
        remaining_units=10,
    )
    db_session.add(trade)
    db_session.commit()
    # Add exit levels
    db_session.add_all([
        ExitLevel(trade_id=trade.id, level_type=ExitLevelType.SL, price=95.0, units_pct=1.0, order_index=1, status=ExitLevelStatus.PENDING, move_sl_to_breakeven=False),
        ExitLevel(trade_id=trade.id, level_type=ExitLevelType.TP, price=115.0, units_pct=1.0, order_index=1, status=ExitLevelStatus.PENDING, move_sl_to_breakeven=False),
    ])
    db_session.commit()

    # Try to order without any funds deposited
    response = client.patch(
        f"/api/trades/{trade.id}",
        json={"status": "ordered"},
        headers=auth_headers,
    )
    assert response.status_code == 400
    assert "funds" in response.json()["detail"].lower()


def test_revert_to_ordered_endpoint(
    client: TestClient,
    sample_trade: Trade,
    auth_headers: dict[str, str],
) -> None:
    """POST /revert-to-ordered flips an open trade back to ordered."""
    response = client.post(
        f"/api/trades/{sample_trade.id}/revert-to-ordered",
        headers=auth_headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["trade"]["status"] == "ordered"
    assert body["trade"]["date_actual"] is None


def test_revert_to_ordered_blocks_non_open(
    client: TestClient,
    db_session: Session,
    sample_ticker: Ticker,
    sample_user: User,
    auth_headers: dict[str, str],
) -> None:
    """Reverting a non-open trade returns 400."""
    trade = Trade(
        ticker=sample_ticker.symbol,
        status=TradeStatus.PLAN,
        amount=1000.0,
        units=10,
        entry_price=100.0,
        date_planned=date(2025, 1, 15),
        user_id=sample_user.id,
        remaining_units=10,
    )
    db_session.add(trade)
    db_session.commit()

    response = client.post(
        f"/api/trades/{trade.id}/revert-to-ordered",
        headers=auth_headers,
    )
    assert response.status_code == 400
    assert "open" in response.json()["detail"].lower()


def test_revert_to_ordered_missing_returns_404(
    client: TestClient,
    auth_headers: dict[str, str],
    sample_user: User,
) -> None:
    """Reverting a non-existent trade returns 404."""
    response = client.post(
        "/api/trades/9999/revert-to-ordered",
        headers=auth_headers,
    )
    assert response.status_code == 404
