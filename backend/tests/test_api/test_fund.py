"""Tests for the fund API endpoints."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from asistrader.models.db import User
from asistrader.services.fund_service import create_deposit


def test_get_events_empty(
    client: TestClient, auth_headers: dict[str, str], sample_user: User
) -> None:
    """Test listing events when none exist."""
    response = client.get("/api/fund/events", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["events"] == []
    assert data["count"] == 0


def test_deposit_endpoint(
    client: TestClient, auth_headers: dict[str, str], sample_user: User
) -> None:
    """Test creating a deposit via API."""
    response = client.post(
        "/api/fund/deposit",
        json={"amount": 5000.0, "description": "Initial deposit"},
        headers=auth_headers,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["event"]["event_type"] == "deposit"
    assert data["event"]["amount"] == 5000.0
    assert data["event"]["description"] == "Initial deposit"


def test_withdrawal_endpoint(
    client: TestClient, db_session: Session, auth_headers: dict[str, str], sample_user: User
) -> None:
    """Test creating a withdrawal via API."""
    create_deposit(db_session, sample_user.id, 10000.0)

    response = client.post(
        "/api/fund/withdrawal",
        json={"amount": 3000.0},
        headers=auth_headers,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["event"]["event_type"] == "withdrawal"
    assert data["event"]["amount"] == 3000.0


def test_withdrawal_insufficient_funds(
    client: TestClient, auth_headers: dict[str, str], sample_user: User
) -> None:
    """Test withdrawal with insufficient funds returns 400."""
    response = client.post(
        "/api/fund/withdrawal",
        json={"amount": 1000.0},
        headers=auth_headers,
    )
    assert response.status_code == 400
    assert "Insufficient funds" in response.json()["detail"]


def test_manual_benefit_event(
    client: TestClient, auth_headers: dict[str, str], sample_user: User
) -> None:
    """Test creating a manual benefit event."""
    response = client.post(
        "/api/fund/manual-event",
        json={"event_type": "benefit", "amount": 500.0, "description": "Dividend"},
        headers=auth_headers,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["event"]["event_type"] == "benefit"
    assert data["event"]["amount"] == 500.0


def test_void_event_endpoint(
    client: TestClient, db_session: Session, auth_headers: dict[str, str], sample_user: User
) -> None:
    """Test voiding a fund event."""
    event = create_deposit(db_session, sample_user.id, 5000.0)

    response = client.patch(
        f"/api/fund/events/{event.id}/void",
        headers=auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["event"]["voided"] is True


def test_get_events_filtered(
    client: TestClient, db_session: Session, auth_headers: dict[str, str], sample_user: User
) -> None:
    """Test listing events with event_type filter."""
    create_deposit(db_session, sample_user.id, 5000.0)

    response = client.get(
        "/api/fund/events?event_type=deposit",
        headers=auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 1
    assert data["events"][0]["event_type"] == "deposit"


def test_get_settings_default(
    client: TestClient, auth_headers: dict[str, str], sample_user: User
) -> None:
    """Test getting default risk settings."""
    response = client.get("/api/fund/settings", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["risk_pct"] == 0.02


def test_update_settings(
    client: TestClient, auth_headers: dict[str, str], sample_user: User
) -> None:
    """Test updating risk settings."""
    response = client.patch(
        "/api/fund/settings",
        json={"risk_pct": 0.05},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["risk_pct"] == 0.05

    # Verify persistence
    response = client.get("/api/fund/settings", headers=auth_headers)
    assert response.json()["risk_pct"] == 0.05


def test_fund_unauthorized(client: TestClient) -> None:
    """Test that unauthenticated requests are rejected."""
    response = client.get("/api/fund/events")
    assert response.status_code == 401
