"""Tests for the FX API endpoints."""

from datetime import date
from unittest.mock import MagicMock, patch

import pandas as pd
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from asistrader.models.db import (
    Bias,
    FxRate,
    Strategy,
    Ticker,
    Trade,
    TradeStatus,
    User,
    UserFundSettings,
)


# ── GET /api/fx/rates ──


def test_get_rates_empty(
    client: TestClient, auth_headers: dict[str, str], sample_user: User
) -> None:
    """No rates stored: returns an empty list per requested currency."""
    response = client.get("/api/fx/rates?currencies=EUR", headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == {"rates": {"EUR": []}}


def test_get_rates_returns_stored_rows(
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    sample_user: User,
) -> None:
    db_session.add_all([
        FxRate(currency="EUR", date=date(2026, 5, 1), rate_to_usd=1.10),
        FxRate(currency="EUR", date=date(2026, 5, 2), rate_to_usd=1.11),
    ])
    db_session.commit()

    response = client.get("/api/fx/rates?currencies=EUR", headers=auth_headers)
    assert response.status_code == 200
    rows = response.json()["rates"]["EUR"]
    assert len(rows) == 2
    assert rows[0] == {"currency": "EUR", "date": "2026-05-01", "rate_to_usd": 1.10}


def test_get_rates_respects_date_range(
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    sample_user: User,
) -> None:
    db_session.add_all([
        FxRate(currency="EUR", date=date(2026, 4, 1), rate_to_usd=1.05),
        FxRate(currency="EUR", date=date(2026, 5, 1), rate_to_usd=1.10),
        FxRate(currency="EUR", date=date(2026, 6, 1), rate_to_usd=1.15),
    ])
    db_session.commit()

    response = client.get(
        "/api/fx/rates?currencies=EUR&from=2026-05-01&to=2026-05-31",
        headers=auth_headers,
    )
    assert response.status_code == 200
    rows = response.json()["rates"]["EUR"]
    assert len(rows) == 1
    assert rows[0]["date"] == "2026-05-01"


def test_get_rates_multiple_currencies(
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    sample_user: User,
) -> None:
    db_session.add_all([
        FxRate(currency="EUR", date=date(2026, 5, 1), rate_to_usd=1.10),
        FxRate(currency="GBP", date=date(2026, 5, 1), rate_to_usd=1.25),
    ])
    db_session.commit()

    response = client.get("/api/fx/rates?currencies=EUR,GBP", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()["rates"]
    assert data["EUR"][0]["rate_to_usd"] == 1.10
    assert data["GBP"][0]["rate_to_usd"] == 1.25


def test_get_rates_usd_returns_empty_list(
    client: TestClient, auth_headers: dict[str, str], sample_user: User
) -> None:
    """USD is implicit (rate 1.0) — never stored, returns []."""
    response = client.get("/api/fx/rates?currencies=USD", headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == {"rates": {"USD": []}}


def test_get_rates_requires_auth(client: TestClient, sample_user: User) -> None:
    response = client.get("/api/fx/rates?currencies=EUR")
    assert response.status_code == 401


# ── POST /api/fx/sync ──


@patch("asistrader.services.fx_service.fetch_from_yfinance")
def test_sync_with_explicit_currencies(
    mock_fetch: MagicMock,
    client: TestClient,
    auth_headers: dict[str, str],
    sample_user: User,
) -> None:
    """Caller supplies an explicit currency list — only those are synced."""
    mock_fetch.return_value = pd.DataFrame(
        {
            "Open": [1.10],
            "High": [1.11],
            "Low": [1.09],
            "Close": [1.10],
            "Volume": [0],
        },
        index=pd.DatetimeIndex([date(2026, 5, 1)]),
    )

    response = client.post(
        "/api/fx/sync",
        json={"start_date": "2026-05-01", "currencies": ["EUR"]},
        headers=auth_headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["results"]["EUR"] == 1
    assert body["total_rows"] == 1
    assert mock_fetch.call_count == 1


@patch("asistrader.services.fx_service.fetch_from_yfinance")
def test_sync_derives_currencies_from_user_tickers(
    mock_fetch: MagicMock,
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    sample_user: User,
    sample_strategy: Strategy,
) -> None:
    """No `currencies` in request → derived from user's ticker currencies + base."""
    eur_ticker = Ticker(
        symbol="MTS.MC",
        currency="EUR",
        bias=Bias.LONG,
        horizon="swing",
        strategy_id=sample_strategy.id,
    )
    db_session.add(eur_ticker)
    db_session.commit()
    db_session.add(
        Trade(
            ticker=eur_ticker.symbol,
            status=TradeStatus.OPEN,
            amount=10000.0,
            units=100,
            entry_price=100.0,
            date_planned=date(2026, 4, 15),
            date_actual=date(2026, 4, 20),
            user_id=sample_user.id,
        )
    )
    db_session.commit()

    mock_fetch.return_value = pd.DataFrame(
        {
            "Open": [1.10],
            "High": [1.11],
            "Low": [1.09],
            "Close": [1.10],
            "Volume": [0],
        },
        index=pd.DatetimeIndex([date(2026, 5, 1)]),
    )

    response = client.post(
        "/api/fx/sync",
        json={"start_date": "2026-05-01"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    body = response.json()
    # EUR was synced; USD (the user's default base) was skipped.
    assert "EUR" in body["results"]
    assert "USD" in body["skipped"]


def test_sync_requires_auth(client: TestClient, sample_user: User) -> None:
    response = client.post("/api/fx/sync", json={"start_date": "2026-05-01"})
    assert response.status_code == 401


@patch("asistrader.services.fx_service.fetch_from_yfinance")
def test_sync_uses_user_base_currency_when_set(
    mock_fetch: MagicMock,
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    sample_user: User,
) -> None:
    """If the user's base is EUR, an empty-currency sync request still includes EUR."""
    db_session.add(UserFundSettings(user_id=sample_user.id, base_currency="EUR"))
    db_session.commit()

    mock_fetch.return_value = pd.DataFrame(
        {
            "Open": [1.10], "High": [1.11], "Low": [1.09],
            "Close": [1.10], "Volume": [0],
        },
        index=pd.DatetimeIndex([date(2026, 5, 1)]),
    )

    response = client.post(
        "/api/fx/sync",
        json={"start_date": "2026-05-01"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    body = response.json()
    # EUR is the base — included in the sync.
    assert "EUR" in body["results"] or "EUR" in body["skipped"]
