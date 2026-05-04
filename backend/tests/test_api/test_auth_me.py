"""Tests for the /api/auth/me endpoint and its auto-sync side effect."""

from datetime import date
from unittest.mock import patch

import pandas as pd
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from asistrader.models.db import (
    Benchmark,
    Bias,
    Strategy,
    Ticker,
    Trade,
    TradeStatus,
    User,
)


def _ohlc(d: date) -> pd.DataFrame:
    return pd.DataFrame(
        {"Open": [1.0], "High": [1.0], "Low": [1.0], "Close": [1.0], "Volume": [0]},
        index=pd.DatetimeIndex([d]),
    )


def test_me_triggers_auto_sync(
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    sample_user: User,
    sample_strategy: Strategy,
) -> None:
    """Hitting /me kicks off FX, ticker, and benchmark sync as a side effect."""
    db_session.add_all([
        Ticker(
            symbol="MTS.MC", currency="EUR", bias=Bias.LONG,
            horizon="swing", strategy_id=sample_strategy.id,
        ),
        Benchmark(symbol="^STOXX50E"),
    ])
    db_session.commit()
    db_session.add(
        Trade(
            ticker="MTS.MC", status=TradeStatus.OPEN,
            amount=1000.0, units=10, entry_price=100.0,
            date_planned=date(2025, 1, 15),
            date_actual=date(2025, 1, 20),
            user_id=sample_user.id,
        )
    )
    db_session.commit()

    with patch(
        "asistrader.services.fx_service.fetch_from_yfinance"
    ) as mock_fx, patch(
        "asistrader.services.market_data_service.fetch_from_yfinance"
    ) as mock_md, patch(
        "asistrader.services.benchmark_service.fetch_from_yfinance"
    ) as mock_bench:
        mock_fx.return_value = _ohlc(date(2025, 1, 20))
        mock_md.return_value = _ohlc(date(2025, 1, 20))
        mock_bench.return_value = _ohlc(date(2025, 1, 20))

        response = client.get("/api/auth/me", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["email"] == sample_user.email

    # All three stages were exercised.
    assert mock_fx.call_count >= 1
    assert mock_md.call_count >= 1
    assert mock_bench.call_count >= 1


def test_me_tolerates_total_sync_failure(
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    sample_user: User,
    sample_strategy: Strategy,
) -> None:
    """If every external sync stage fails, /me must still return the user."""
    db_session.add(
        Ticker(
            symbol="MTS.MC", currency="EUR", bias=Bias.LONG,
            horizon="swing", strategy_id=sample_strategy.id,
        )
    )
    db_session.commit()
    db_session.add(
        Trade(
            ticker="MTS.MC", status=TradeStatus.OPEN,
            amount=1000.0, units=10, entry_price=100.0,
            date_planned=date(2025, 1, 15),
            user_id=sample_user.id,
        )
    )
    db_session.commit()

    with patch(
        "asistrader.services.fx_service.fetch_from_yfinance"
    ) as mock_fx, patch(
        "asistrader.services.market_data_service.fetch_from_yfinance"
    ) as mock_md, patch(
        "asistrader.services.benchmark_service.fetch_from_yfinance"
    ) as mock_bench:
        mock_fx.side_effect = Exception("yfinance down")
        mock_md.side_effect = Exception("yfinance down")
        mock_bench.side_effect = Exception("yfinance down")

        response = client.get("/api/auth/me", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["email"] == sample_user.email


def test_me_unauthorized(client: TestClient) -> None:
    response = client.get("/api/auth/me")
    assert response.status_code == 401
