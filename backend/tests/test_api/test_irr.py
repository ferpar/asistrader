"""Tests for the IRR / Drivers API endpoint."""

from datetime import date, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from asistrader.models.db import Ticker, Trade, TradeStatus, User


def test_irr_analysis_empty(
    client: TestClient, auth_headers: dict[str, str], sample_user: User
) -> None:
    """Empty account returns well-formed, empty scopes."""
    response = client.get("/api/irr/analysis", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["base_currency"] == "USD"
    assert data["realized"]["transactions"] == []
    assert data["realized"]["portfolio"] is None
    assert data["daily"]["mixed"] == []


def test_irr_analysis_requires_auth(client: TestClient) -> None:
    assert client.get("/api/irr/analysis").status_code == 401


def test_irr_analysis_with_closed_trade(
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    sample_user: User,
) -> None:
    """A closed trade surfaces in the realized scope with the expected TIR."""
    day = date(2025, 3, 1)
    db_session.add(Ticker(symbol="TKA", name="Ticker A", currency="USD"))
    db_session.add(
        Trade(
            ticker="TKA",
            status=TradeStatus.CLOSE,
            amount=2310.0,
            units=1,
            entry_price=2310.0,
            exit_price=2385.0,  # +75 profit
            date_planned=day - timedelta(days=15),
            date_ordered=day - timedelta(days=15),
            exit_date=day,
            user_id=sample_user.id,
        )
    )
    db_session.commit()

    response = client.get("/api/irr/analysis", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()

    txns = data["realized"]["transactions"]
    assert len(txns) == 1
    assert txns[0]["ticker"] == "TKA"
    assert txns[0]["tir"] == 0.79 or abs(txns[0]["tir"] - 0.79) < 1e-3
    assert txns[0]["is_winner"] is True
    assert len(data["daily"]["mixed"]) == 1
