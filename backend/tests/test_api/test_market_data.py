"""Tests for the market data API endpoints."""

from datetime import date
from unittest.mock import MagicMock, patch

import pandas as pd
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from asistrader.models.db import MarketData, Ticker


def test_get_market_data_empty(client: TestClient, db_session: Session, sample_ticker: Ticker) -> None:
    """Test getting market data when none exists."""
    response = client.get(f"/api/market-data/{sample_ticker.symbol}")
    assert response.status_code == 200
    data = response.json()
    assert data["data"] == []
    assert data["count"] == 0
    assert data["earliest_date"] is None
    assert data["latest_date"] is None


def test_get_market_data_with_data(
    client: TestClient, db_session: Session, sample_ticker: Ticker, sample_market_data: list[MarketData]
) -> None:
    """Test getting market data with existing data."""
    response = client.get(f"/api/market-data/{sample_ticker.symbol}")
    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 3
    assert len(data["data"]) == 3
    assert data["earliest_date"] == "2024-01-02"
    assert data["latest_date"] == "2024-01-04"

    # Check first data point
    first = data["data"][0]
    assert first["ticker"] == "ASML"
    assert first["date"] == "2024-01-02"
    assert first["open"] == 100.0
    assert first["high"] == 105.0
    assert first["low"] == 99.0
    assert first["close"] == 104.0
    assert first["volume"] == 1000000.0


def test_get_market_data_with_date_filter(
    client: TestClient, db_session: Session, sample_ticker: Ticker, sample_market_data: list[MarketData]
) -> None:
    """Test getting market data with date filters."""
    response = client.get(
        f"/api/market-data/{sample_ticker.symbol}",
        params={"start_date": "2024-01-03", "end_date": "2024-01-03"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 1
    assert data["data"][0]["date"] == "2024-01-03"


@patch("asistrader.services.market_data_service.fetch_from_yfinance")
def test_fetch_market_data(
    mock_fetch: MagicMock, client: TestClient, db_session: Session, sample_ticker: Ticker
) -> None:
    """Test fetching market data from yfinance."""
    mock_df = pd.DataFrame(
        {
            "Open": [100.0, 101.0],
            "High": [105.0, 106.0],
            "Low": [99.0, 100.0],
            "Close": [104.0, 105.0],
            "Volume": [1000000, 1100000],
        },
        index=pd.DatetimeIndex([date(2024, 1, 5), date(2024, 1, 6)]),
    )
    mock_fetch.return_value = mock_df

    response = client.post(
        f"/api/market-data/{sample_ticker.symbol}/fetch",
        json={"start_date": "2024-01-05", "end_date": "2024-01-06"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 2


@patch("asistrader.services.market_data_service.fetch_from_yfinance")
def test_fetch_market_data_creates_ticker(
    mock_fetch: MagicMock, client: TestClient, db_session: Session
) -> None:
    """Test that fetching market data creates ticker if it doesn't exist."""
    mock_df = pd.DataFrame(
        {
            "Open": [100.0],
            "High": [105.0],
            "Low": [99.0],
            "Close": [104.0],
            "Volume": [1000000],
        },
        index=pd.DatetimeIndex([date(2024, 1, 5)]),
    )
    mock_fetch.return_value = mock_df

    response = client.post(
        "/api/market-data/NEWTICKER/fetch",
        json={"start_date": "2024-01-05", "end_date": "2024-01-05"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 1

    # Verify ticker was created
    ticker = db_session.query(Ticker).filter(Ticker.symbol == "NEWTICKER").first()
    assert ticker is not None


@patch("asistrader.services.market_data_service.extend_series")
def test_extend_market_data(
    mock_extend: MagicMock,
    client: TestClient,
    db_session: Session,
    sample_ticker: Ticker,
    sample_market_data: list[MarketData],
) -> None:
    """Test extending market data series."""
    mock_extend.return_value = 5

    response = client.post(
        f"/api/market-data/{sample_ticker.symbol}/extend",
        json={"direction": "forward", "target_date": "2024-01-15"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 3  # Original sample data


@patch("asistrader.services.market_data_service.fetch_from_yfinance")
def test_bulk_fetch(mock_fetch: MagicMock, client: TestClient, db_session: Session) -> None:
    """Test bulk fetching market data."""
    # Create tickers
    ticker1 = Ticker(symbol="ASML")
    ticker2 = Ticker(symbol="NVDA")
    db_session.add_all([ticker1, ticker2])
    db_session.commit()

    mock_df = pd.DataFrame(
        {
            "Open": [100.0],
            "High": [105.0],
            "Low": [99.0],
            "Close": [104.0],
            "Volume": [1000000],
        },
        index=pd.DatetimeIndex([date(2024, 1, 5)]),
    )
    mock_fetch.return_value = mock_df

    response = client.post(
        "/api/market-data/fetch-all",
        json={"start_date": "2024-01-05", "end_date": "2024-01-05"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["total_rows"] == 2
    assert "ASML" in data["results"]
    assert "NVDA" in data["results"]


@patch("asistrader.services.market_data_service.fetch_from_yfinance")
def test_bulk_fetch_specific_symbols(
    mock_fetch: MagicMock, client: TestClient, db_session: Session
) -> None:
    """Test bulk fetching market data for specific symbols."""
    # Create tickers
    ticker1 = Ticker(symbol="ASML")
    ticker2 = Ticker(symbol="NVDA")
    ticker3 = Ticker(symbol="AAPL")
    db_session.add_all([ticker1, ticker2, ticker3])
    db_session.commit()

    mock_df = pd.DataFrame(
        {
            "Open": [100.0],
            "High": [105.0],
            "Low": [99.0],
            "Close": [104.0],
            "Volume": [1000000],
        },
        index=pd.DatetimeIndex([date(2024, 1, 5)]),
    )
    mock_fetch.return_value = mock_df

    response = client.post(
        "/api/market-data/fetch-all",
        json={"start_date": "2024-01-05", "end_date": "2024-01-05", "symbols": ["ASML", "NVDA"]},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["total_rows"] == 2
    assert "ASML" in data["results"]
    assert "NVDA" in data["results"]
    assert "AAPL" not in data["results"]


@patch("asistrader.services.market_data_service.extend_series")
def test_bulk_extend(
    mock_extend: MagicMock, client: TestClient, db_session: Session
) -> None:
    """Test bulk extending market data."""
    ticker1 = Ticker(symbol="ASML")
    ticker2 = Ticker(symbol="NVDA")
    db_session.add_all([ticker1, ticker2])
    db_session.commit()

    mock_extend.return_value = 5

    response = client.post(
        "/api/market-data/extend-all",
        json={"direction": "forward", "target_date": "2024-01-15"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["total_rows"] == 10  # 5 per ticker
    assert data["results"]["ASML"] == 5
    assert data["results"]["NVDA"] == 5
