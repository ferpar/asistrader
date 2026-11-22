"""Tests for the market data API endpoints."""

from datetime import date
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from asistrader.models.db import MarketData, Ticker


# These routes require a logged-in user; see the `signed_in` fixture.
pytestmark = pytest.mark.usefixtures("signed_in")


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


def test_bulk_market_data_with_data(
    client: TestClient, db_session: Session, sample_ticker: Ticker, sample_market_data: list[MarketData]
) -> None:
    """Test bulk market data retrieval returns stored data keyed by symbol."""
    response = client.post(
        "/api/market-data/bulk",
        json={"symbols": [sample_ticker.symbol], "start_date": "2024-01-01"},
    )
    assert response.status_code == 200
    data = response.json()
    series = data["data"][sample_ticker.symbol]
    assert series["dates"] == ["2024-01-02", "2024-01-03", "2024-01-04"]
    assert len(series["close"]) == 3
    assert series["close"][0] == 104.0
    assert data["errors"] == {}


def test_bulk_market_data_empty(
    client: TestClient, db_session: Session, sample_ticker: Ticker
) -> None:
    """Test bulk market data for a ticker with no data returns empty arrays."""
    response = client.post(
        "/api/market-data/bulk",
        json={"symbols": [sample_ticker.symbol], "start_date": "2024-01-01"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["data"][sample_ticker.symbol] == {"dates": [], "close": [], "adj_close": []}


def test_bulk_market_data_unknown_symbol(
    client: TestClient, db_session: Session
) -> None:
    """Test bulk market data for a nonexistent symbol returns empty data."""
    response = client.post(
        "/api/market-data/bulk",
        json={"symbols": ["ZZZZZ"], "start_date": "2024-01-01"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["data"]["ZZZZZ"] == {"dates": [], "close": [], "adj_close": []}


def test_bulk_market_data_with_date_filter(
    client: TestClient, db_session: Session, sample_ticker: Ticker, sample_market_data: list[MarketData]
) -> None:
    """Test bulk market data respects start_date filter."""
    response = client.post(
        "/api/market-data/bulk",
        json={"symbols": [sample_ticker.symbol], "start_date": "2024-01-03"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["data"][sample_ticker.symbol]["dates"] == ["2024-01-03", "2024-01-04"]


def test_bulk_market_data_multiple_symbols(
    client: TestClient, db_session: Session, sample_ticker: Ticker, sample_market_data: list[MarketData]
) -> None:
    """Each symbol gets only its own rows, in date order, from a single request."""
    db_session.add(Ticker(symbol="NVDA"))
    db_session.add_all(
        [
            MarketData(ticker="NVDA", date=date(2024, 1, 4), open=1, high=2, low=1, close=2.0, volume=10),
            MarketData(ticker="NVDA", date=date(2024, 1, 3), open=1, high=2, low=1, close=1.5, volume=10),
        ]
    )
    db_session.commit()

    response = client.post(
        "/api/market-data/bulk",
        json={"symbols": [sample_ticker.symbol, "NVDA", "ZZZZZ"], "start_date": "2024-01-01"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data[sample_ticker.symbol]["dates"] == ["2024-01-02", "2024-01-03", "2024-01-04"]
    assert data["NVDA"] == {"dates": ["2024-01-03", "2024-01-04"], "close": [1.5, 2.0], "adj_close": [None, None]}
    assert data["ZZZZZ"] == {"dates": [], "close": [], "adj_close": []}


def test_bulk_market_data_skips_missing_closes(
    client: TestClient, db_session: Session, sample_ticker: Ticker, sample_market_data: list[MarketData]
) -> None:
    """A row without a close is left out so dates and close stay aligned."""
    db_session.add(MarketData(ticker=sample_ticker.symbol, date=date(2024, 1, 5), close=None))
    db_session.commit()

    response = client.post(
        "/api/market-data/bulk",
        json={"symbols": [sample_ticker.symbol], "start_date": "2024-01-01"},
    )
    series = response.json()["data"][sample_ticker.symbol]
    assert series["dates"] == ["2024-01-02", "2024-01-03", "2024-01-04"]
    assert len(series["close"]) == 3


def test_bulk_market_data_returns_adjusted_closes(
    client: TestClient, db_session: Session, sample_ticker: Ticker
) -> None:
    """Each series carries an adj_close array aligned with dates; null where not filled."""
    db_session.add_all(
        [
            MarketData(ticker=sample_ticker.symbol, date=date(2024, 1, 2), close=104.0, adj_close=101.5),
            MarketData(ticker=sample_ticker.symbol, date=date(2024, 1, 3), close=106.0, adj_close=None),
        ]
    )
    db_session.commit()

    response = client.post(
        "/api/market-data/bulk",
        json={"symbols": [sample_ticker.symbol], "start_date": "2024-01-01"},
    )
    assert response.status_code == 200
    assert response.json()["data"][sample_ticker.symbol] == {
        "dates": ["2024-01-02", "2024-01-03"],
        "close": [104.0, 106.0],
        "adj_close": [101.5, None],
    }


def _frame_with_adj_close(days: list[date], closes: list[float], adj: list[float]) -> pd.DataFrame:
    """A yfinance-shaped history frame (auto_adjust=False) including Adj Close."""
    return pd.DataFrame(
        {
            "Open": closes,
            "High": closes,
            "Low": closes,
            "Close": closes,
            "Adj Close": adj,
            "Volume": [1000] * len(days),
        },
        index=pd.DatetimeIndex(days),
    )


@patch("asistrader.services.market_data_service.fetch_from_yfinance")
def test_sync_all_stores_adjusted_close_next_to_raw_close(
    mock_fetch: MagicMock, client: TestClient, db_session: Session
) -> None:
    """Synced rows keep the raw close and also carry yfinance's adjusted close."""
    db_session.add(Ticker(symbol="KO", currency="USD", price_hint=2))
    db_session.commit()
    mock_fetch.return_value = _frame_with_adj_close(
        [date(2024, 1, 2), date(2024, 1, 3)], [60.0, 61.0], [55.2, 56.1]
    )

    response = client.post(
        "/api/market-data/sync-all",
        json={"start_date": "2024-01-02", "symbols": ["KO"]},
    )
    assert response.status_code == 200

    series = client.post(
        "/api/market-data/bulk", json={"symbols": ["KO"], "start_date": "2024-01-01"}
    ).json()["data"]["KO"]
    assert series == {
        "dates": ["2024-01-02", "2024-01-03"],
        "close": [60.0, 61.0],
        "adj_close": [55.2, 56.1],
    }


@patch("asistrader.services.market_data_service.fetch_from_yfinance")
def test_sync_all_refreshes_stored_adjusted_closes_after_a_split(
    mock_fetch: MagicMock, client: TestClient, db_session: Session
) -> None:
    """A split in the newly synced bars re-adjusts earlier rows, so the series has no fake crash."""
    db_session.add(Ticker(symbol="KO", currency="USD", price_hint=2))
    db_session.commit()
    db_session.add_all(
        [
            MarketData(ticker="KO", date=date(2024, 1, 2), close=100.0, adj_close=100.0),
            MarketData(ticker="KO", date=date(2024, 1, 3), close=102.0, adj_close=102.0),
        ]
    )
    db_session.commit()

    def fake_fetch(symbol: str, start: date, end: date) -> pd.DataFrame:
        if start == date(2024, 1, 2):
            # Yahoo now reports the old bars adjusted for the 2:1 split.
            return _frame_with_adj_close(
                [date(2024, 1, 2), date(2024, 1, 3), date(2024, 1, 4)],
                [100.0, 102.0, 51.5],
                [50.0, 51.0, 51.5],
            )
        frame = _frame_with_adj_close([date(2024, 1, 4)], [51.5], [51.5])
        frame["Stock Splits"] = [2.0]
        frame["Dividends"] = [0.0]
        return frame

    mock_fetch.side_effect = fake_fetch

    response = client.post(
        "/api/market-data/sync-all", json={"start_date": "2024-01-02", "symbols": ["KO"]}
    )
    assert response.status_code == 200

    series = client.post(
        "/api/market-data/bulk", json={"symbols": ["KO"], "start_date": "2024-01-01"}
    ).json()["data"]["KO"]
    assert series["close"] == [100.0, 102.0, 51.5]
    assert series["adj_close"] == [50.0, 51.0, 51.5]


@patch("asistrader.services.market_data_service.fetch_from_yfinance")
def test_backfill_fills_adjusted_closes_of_existing_rows(
    mock_fetch: MagicMock, client: TestClient, db_session: Session
) -> None:
    """Rows stored before adjusted closes existed get them; complete tickers aren't refetched."""
    db_session.add_all([Ticker(symbol="KO"), Ticker(symbol="PEP")])
    db_session.commit()
    db_session.add_all(
        [
            MarketData(ticker="KO", date=date(2024, 1, 2), close=60.0),
            MarketData(ticker="KO", date=date(2024, 1, 3), close=61.0),
            MarketData(ticker="PEP", date=date(2024, 1, 2), close=170.0, adj_close=160.0),
        ]
    )
    db_session.commit()
    mock_fetch.return_value = _frame_with_adj_close(
        [date(2024, 1, 2), date(2024, 1, 3)], [60.0, 61.0], [55.2, 56.1]
    )

    response = client.post("/api/market-data/backfill-adjusted-closes", json={})
    assert response.status_code == 200
    body = response.json()
    assert body["results"] == {"KO": 2}
    assert body["errors"] == {}

    fetched_symbols = [call.args[0] for call in mock_fetch.call_args_list]
    assert fetched_symbols == ["KO"]
    data = client.post(
        "/api/market-data/bulk", json={"symbols": ["KO", "PEP"], "start_date": "2024-01-01"}
    ).json()["data"]
    assert data["KO"]["adj_close"] == [55.2, 56.1]
    assert data["KO"]["close"] == [60.0, 61.0]
    assert data["PEP"]["adj_close"] == [160.0]


@patch("asistrader.services.market_data_service.fetch_from_yfinance")
def test_backfill_reports_per_symbol_errors(
    mock_fetch: MagicMock, client: TestClient, db_session: Session
) -> None:
    """A failing Yahoo fetch is reported for that symbol without aborting the rest."""
    db_session.add_all([Ticker(symbol="KO"), Ticker(symbol="BAD")])
    db_session.commit()
    db_session.add_all(
        [
            MarketData(ticker="KO", date=date(2024, 1, 2), close=60.0),
            MarketData(ticker="BAD", date=date(2024, 1, 2), close=1.0),
        ]
    )
    db_session.commit()

    def fake_fetch(symbol: str, start: date, end: date) -> pd.DataFrame:
        if symbol == "BAD":
            raise RuntimeError("yahoo down")
        return _frame_with_adj_close([date(2024, 1, 2)], [60.0], [55.2])

    mock_fetch.side_effect = fake_fetch

    body = client.post("/api/market-data/backfill-adjusted-closes", json={}).json()
    assert body["results"]["KO"] == 1
    assert "yahoo down" in body["errors"]["BAD"]
