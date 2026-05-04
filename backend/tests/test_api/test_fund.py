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
    """Test getting default risk + base-currency settings."""
    response = client.get("/api/fund/settings", headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["risk_pct"] == 0.02
    assert body["base_currency"] == "USD"


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


def test_update_base_currency(
    client: TestClient, auth_headers: dict[str, str], sample_user: User
) -> None:
    """PATCH base_currency updates and persists."""
    response = client.patch(
        "/api/fund/settings",
        json={"base_currency": "EUR"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["base_currency"] == "EUR"
    # risk_pct should retain its default
    assert response.json()["risk_pct"] == 0.02

    response = client.get("/api/fund/settings", headers=auth_headers)
    assert response.json()["base_currency"] == "EUR"


def test_update_base_currency_uppercases_input(
    client: TestClient, auth_headers: dict[str, str], sample_user: User
) -> None:
    response = client.patch(
        "/api/fund/settings",
        json={"base_currency": "eur"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["base_currency"] == "EUR"


def test_update_risk_pct_does_not_reset_base_currency(
    client: TestClient, auth_headers: dict[str, str], sample_user: User
) -> None:
    """Updating one field must not clobber the other."""
    client.patch(
        "/api/fund/settings",
        json={"base_currency": "EUR"},
        headers=auth_headers,
    )
    response = client.patch(
        "/api/fund/settings",
        json={"risk_pct": 0.05},
        headers=auth_headers,
    )
    body = response.json()
    assert body["risk_pct"] == 0.05
    assert body["base_currency"] == "EUR"


def test_deposit_in_eur(
    client: TestClient, auth_headers: dict[str, str], sample_user: User
) -> None:
    """Deposit endpoint accepts a `currency` field."""
    response = client.post(
        "/api/fund/deposit",
        json={"amount": 1000.0, "currency": "EUR"},
        headers=auth_headers,
    )
    assert response.status_code == 201
    event = response.json()["event"]
    assert event["amount"] == 1000.0
    assert event["currency"] == "EUR"


def test_event_response_carries_currency(
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    sample_user: User,
) -> None:
    """Listing events returns the stored currency on each row."""
    create_deposit(db_session, sample_user.id, 1000.0)  # default USD
    create_deposit(db_session, sample_user.id, 500.0, currency="EUR")

    response = client.get("/api/fund/events", headers=auth_headers)
    assert response.status_code == 200
    currencies = sorted(e["currency"] for e in response.json()["events"])
    assert currencies == ["EUR", "USD"]


def test_repair_currencies_endpoint(
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    sample_user: User,
    sample_strategy,
) -> None:
    """End-to-end repair through the API."""
    from datetime import date

    from asistrader.models.db import (
        Bias,
        FundEvent,
        FundEventType,
        Ticker,
        Trade,
        TradeStatus,
    )

    eur_ticker = Ticker(
        symbol="MTS.MC",
        currency="EUR",
        bias=Bias.LONG,
        horizon="swing",
        strategy_id=sample_strategy.id,
    )
    db_session.add(eur_ticker)
    db_session.commit()

    trade = Trade(
        ticker="MTS.MC",
        status=TradeStatus.OPEN,
        amount=10000.0,
        units=100,
        entry_price=100.0,
        date_planned=date(2025, 1, 15),
        date_actual=date(2025, 1, 16),
        user_id=sample_user.id,
    )
    db_session.add(trade)
    db_session.commit()

    db_session.add(
        FundEvent(
            user_id=sample_user.id,
            event_type=FundEventType.RESERVE,
            amount=10000.0,
            currency="USD",  # legacy bad tag
            trade_id=trade.id,
            event_date=date(2025, 1, 16),
        )
    )
    db_session.commit()

    response = client.post("/api/fund/repair-currencies", headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body == {"counts": {"reserve": 1}, "total": 1}

    # Calling again is a no-op.
    response = client.post("/api/fund/repair-currencies", headers=auth_headers)
    assert response.json() == {"counts": {}, "total": 0}


def test_repair_currencies_requires_auth(client: TestClient, sample_user: User) -> None:
    response = client.post("/api/fund/repair-currencies")
    assert response.status_code == 401


def test_list_events_auto_syncs_fx(
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    sample_user: User,
    sample_strategy,
) -> None:
    """Visiting /api/fund/events triggers a best-effort FX sync — the user
    never has to manually press 'refresh' to get FX history."""
    from datetime import date
    from unittest.mock import patch

    import pandas as pd

    from asistrader.models.db import Bias, Ticker, Trade, TradeStatus

    db_session.add(
        Ticker(
            symbol="MTS.MC",
            currency="EUR",
            bias=Bias.LONG,
            horizon="swing",
            strategy_id=sample_strategy.id,
        )
    )
    db_session.commit()
    db_session.add(
        Trade(
            ticker="MTS.MC",
            status=TradeStatus.OPEN,
            amount=1000.0,
            units=10,
            entry_price=100.0,
            date_planned=date(2025, 1, 15),
            date_actual=date(2025, 1, 20),
            user_id=sample_user.id,
        )
    )
    db_session.commit()

    with patch("asistrader.services.fx_service.fetch_from_yfinance") as mock_fetch:
        mock_fetch.return_value = pd.DataFrame(
            {
                "Open": [1.10], "High": [1.10], "Low": [1.10],
                "Close": [1.10], "Volume": [0],
            },
            index=pd.DatetimeIndex([date(2025, 1, 20)]),
        )

        response = client.get("/api/fund/events", headers=auth_headers)
        assert response.status_code == 200
        # yfinance was called for the user's EUR currency.
        assert mock_fetch.call_count >= 1
        called_symbols = {call[0][0] for call in mock_fetch.call_args_list}
        assert "EURUSD=X" in called_symbols


def test_list_events_tolerates_fx_sync_failure(
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    sample_user: User,
    sample_strategy,
) -> None:
    """A yfinance outage during auto-sync must not break the events read."""
    from datetime import date
    from unittest.mock import patch

    from asistrader.models.db import Bias, Ticker, Trade, TradeStatus

    db_session.add(
        Ticker(
            symbol="MTS.MC",
            currency="EUR",
            bias=Bias.LONG,
            horizon="swing",
            strategy_id=sample_strategy.id,
        )
    )
    db_session.commit()
    db_session.add(
        Trade(
            ticker="MTS.MC",
            status=TradeStatus.OPEN,
            amount=1000.0,
            units=10,
            entry_price=100.0,
            date_planned=date(2025, 1, 15),
            user_id=sample_user.id,
        )
    )
    db_session.commit()

    with patch("asistrader.services.fx_service.fetch_from_yfinance") as mock_fetch:
        mock_fetch.side_effect = Exception("yfinance is down")

        response = client.get("/api/fund/events", headers=auth_headers)

    # Endpoint still returns 200; it just couldn't refresh FX.
    assert response.status_code == 200


def test_fund_unauthorized(client: TestClient) -> None:
    """Test that unauthenticated requests are rejected."""
    response = client.get("/api/fund/events")
    assert response.status_code == 401
