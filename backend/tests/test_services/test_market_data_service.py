"""Tests for the market data service."""

from datetime import date
from unittest.mock import MagicMock, patch

import pandas as pd
from sqlalchemy.orm import Session

from asistrader.models.db import MarketData, Ticker
from asistrader.services import market_data_service


def test_get_market_data_empty(db_session: Session, sample_ticker: Ticker) -> None:
    """Test getting market data when none exists."""
    data = market_data_service.get_market_data(db_session, sample_ticker.symbol)
    assert data == []


def test_get_market_data_with_data(
    db_session: Session, sample_ticker: Ticker, sample_market_data: list[MarketData]
) -> None:
    """Test getting market data with existing data."""
    data = market_data_service.get_market_data(db_session, sample_ticker.symbol)
    assert len(data) == 3
    assert data[0].date == date(2024, 1, 2)
    assert data[1].date == date(2024, 1, 3)
    assert data[2].date == date(2024, 1, 4)


def test_get_market_data_with_date_filter(
    db_session: Session, sample_ticker: Ticker, sample_market_data: list[MarketData]
) -> None:
    """Test getting market data with date filters."""
    data = market_data_service.get_market_data(
        db_session, sample_ticker.symbol, start_date=date(2024, 1, 3), end_date=date(2024, 1, 3)
    )
    assert len(data) == 1
    assert data[0].date == date(2024, 1, 3)


def test_get_market_data_start_date_only(
    db_session: Session, sample_ticker: Ticker, sample_market_data: list[MarketData]
) -> None:
    """Test getting market data with only start date filter."""
    data = market_data_service.get_market_data(
        db_session, sample_ticker.symbol, start_date=date(2024, 1, 3)
    )
    assert len(data) == 2
    assert data[0].date == date(2024, 1, 3)
    assert data[1].date == date(2024, 1, 4)


def test_get_data_bounds_empty(db_session: Session, sample_ticker: Ticker) -> None:
    """Test getting data bounds when no data exists."""
    earliest, latest = market_data_service.get_data_bounds(db_session, sample_ticker.symbol)
    assert earliest is None
    assert latest is None


def test_get_data_bounds_with_data(
    db_session: Session, sample_ticker: Ticker, sample_market_data: list[MarketData]
) -> None:
    """Test getting data bounds with existing data."""
    earliest, latest = market_data_service.get_data_bounds(db_session, sample_ticker.symbol)
    assert earliest == date(2024, 1, 2)
    assert latest == date(2024, 1, 4)


def test_ensure_ticker_exists_creates_new(db_session: Session) -> None:
    """Test that ensure_ticker_exists creates a new ticker if needed."""
    ticker = market_data_service.ensure_ticker_exists(db_session, "NEW")
    assert ticker.symbol == "NEW"

    # Verify it was persisted
    result = db_session.query(Ticker).filter(Ticker.symbol == "NEW").first()
    assert result is not None


def test_ensure_ticker_exists_returns_existing(
    db_session: Session, sample_ticker: Ticker
) -> None:
    """Test that ensure_ticker_exists returns existing ticker."""
    ticker = market_data_service.ensure_ticker_exists(db_session, sample_ticker.symbol)
    assert ticker.symbol == sample_ticker.symbol
    assert ticker.name == sample_ticker.name


def test_get_all_ticker_symbols(
    db_session: Session, sample_ticker: Ticker
) -> None:
    """Test getting all ticker symbols."""
    # Add another ticker
    ticker2 = Ticker(symbol="NVDA", name="NVIDIA")
    db_session.add(ticker2)
    db_session.commit()

    symbols = market_data_service.get_all_ticker_symbols(db_session)
    assert len(symbols) == 2
    assert "ASML" in symbols
    assert "NVDA" in symbols


@patch("asistrader.services.market_data_service.fetch_from_yfinance")
def test_fetch_and_store(
    mock_fetch: MagicMock, db_session: Session, sample_ticker: Ticker
) -> None:
    """Test fetching and storing market data."""
    # Create mock DataFrame
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

    count = market_data_service.fetch_and_store(
        db_session, sample_ticker.symbol, date(2024, 1, 5), date(2024, 1, 6)
    )

    assert count == 2

    # Verify data was stored
    data = market_data_service.get_market_data(db_session, sample_ticker.symbol)
    assert len(data) == 2


@patch("asistrader.services.market_data_service.fetch_from_yfinance")
def test_fetch_and_store_creates_ticker(mock_fetch: MagicMock, db_session: Session) -> None:
    """Test that fetch_and_store creates ticker if it doesn't exist."""
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

    count = market_data_service.fetch_and_store(
        db_session, "NEWTICKER", date(2024, 1, 5), date(2024, 1, 5)
    )

    assert count == 1

    # Verify ticker was created
    ticker = db_session.query(Ticker).filter(Ticker.symbol == "NEWTICKER").first()
    assert ticker is not None


@patch("asistrader.services.market_data_service.fetch_from_yfinance")
def test_bulk_fetch(mock_fetch: MagicMock, db_session: Session) -> None:
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

    result = market_data_service.bulk_fetch(
        db_session, date(2024, 1, 5), date(2024, 1, 5)
    )

    assert result["total_rows"] == 2
    assert result["results"]["ASML"] == 1
    assert result["results"]["NVDA"] == 1
    assert result["errors"] == {}


@patch("asistrader.services.market_data_service.fetch_from_yfinance")
def test_bulk_fetch_with_error(mock_fetch: MagicMock, db_session: Session) -> None:
    """Test bulk fetching handles errors gracefully."""
    ticker = Ticker(symbol="ASML")
    db_session.add(ticker)
    db_session.commit()

    mock_fetch.side_effect = Exception("API error")

    result = market_data_service.bulk_fetch(
        db_session, date(2024, 1, 5), date(2024, 1, 5)
    )

    assert result["total_rows"] == 0
    assert result["results"]["ASML"] == 0
    assert "ASML" in result["errors"]
    assert "API error" in result["errors"]["ASML"]


@patch("asistrader.services.market_data_service.fetch_and_store")
def test_extend_series_forward(
    mock_fetch_store: MagicMock, db_session: Session, sample_ticker: Ticker, sample_market_data: list[MarketData]
) -> None:
    """Test extending series forward."""
    mock_fetch_store.return_value = 5

    count = market_data_service.extend_series(
        db_session, sample_ticker.symbol, "forward", date(2024, 1, 10)
    )

    assert count == 5
    mock_fetch_store.assert_called_once()


@patch("asistrader.services.market_data_service.fetch_and_store")
def test_extend_series_backward(
    mock_fetch_store: MagicMock, db_session: Session, sample_ticker: Ticker, sample_market_data: list[MarketData]
) -> None:
    """Test extending series backward."""
    mock_fetch_store.return_value = 5

    count = market_data_service.extend_series(
        db_session, sample_ticker.symbol, "backward", date(2023, 12, 1)
    )

    assert count == 5
    mock_fetch_store.assert_called_once()


def test_extend_series_no_extension_needed(
    db_session: Session, sample_ticker: Ticker, sample_market_data: list[MarketData]
) -> None:
    """Test that extend_series returns 0 when no extension needed."""
    # Forward extend to a date before latest
    count = market_data_service.extend_series(
        db_session, sample_ticker.symbol, "forward", date(2024, 1, 2)
    )
    assert count == 0

    # Backward extend to a date after earliest
    count = market_data_service.extend_series(
        db_session, sample_ticker.symbol, "backward", date(2024, 1, 5)
    )
    assert count == 0
