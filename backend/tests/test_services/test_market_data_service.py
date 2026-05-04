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


# ── Auto-adjust disabled + force refresh ──


@patch("asistrader.services.market_data_service.yf.Ticker")
def test_fetch_passes_auto_adjust_false(
    mock_ticker_cls: MagicMock, sample_ticker: Ticker
) -> None:
    """yfinance must be called with auto_adjust=False so historical OHLCV
    matches the raw chart values the user sees, not dividend-adjusted."""
    mock_ticker = MagicMock()
    mock_ticker.history.return_value = pd.DataFrame()
    mock_ticker_cls.return_value = mock_ticker

    market_data_service.fetch_from_yfinance(
        sample_ticker.symbol, date(2024, 1, 1), date(2024, 1, 5)
    )

    mock_ticker.history.assert_called_once()
    call_kwargs = mock_ticker.history.call_args.kwargs
    assert call_kwargs.get("auto_adjust") is False


@patch("asistrader.services.market_data_service.fetch_from_yfinance")
def test_force_refresh_wipes_and_refetches(
    mock_fetch: MagicMock,
    db_session: Session,
    sample_ticker: Ticker,
    sample_market_data: list[MarketData],
) -> None:
    """force_refresh=True deletes existing rows and re-fetches the full range."""
    # sample_market_data has 3 existing rows for 2024-01-02..04.
    pre_count = (
        db_session.query(MarketData)
        .filter(MarketData.ticker == sample_ticker.symbol)
        .count()
    )
    assert pre_count == 3

    new_df = pd.DataFrame(
        {
            "Open": [200.0],
            "High": [205.0],
            "Low": [199.0],
            "Close": [204.0],
            "Volume": [1_500_000],
        },
        index=pd.DatetimeIndex([date(2024, 1, 5)]),
    )
    mock_fetch.return_value = new_df

    result = market_data_service.sync_ticker(
        db_session,
        sample_ticker.symbol,
        date(2024, 1, 1),
        force_refresh=True,
    )

    rows = (
        db_session.query(MarketData)
        .filter(MarketData.ticker == sample_ticker.symbol)
        .all()
    )
    # Only the new fetch survives; old rows are gone.
    assert len(rows) == 1
    assert rows[0].date == date(2024, 1, 5)
    assert rows[0].close == 204.0
    assert result["fetched"] == 1


@patch("asistrader.services.market_data_service.fetch_from_yfinance")
def test_default_sync_does_not_wipe(
    mock_fetch: MagicMock,
    db_session: Session,
    sample_ticker: Ticker,
    sample_market_data: list[MarketData],
) -> None:
    """Without force_refresh, gap-detect leaves existing rows untouched."""
    mock_fetch.return_value = pd.DataFrame()

    market_data_service.sync_ticker(
        db_session, sample_ticker.symbol, date(2024, 1, 1)
    )

    rows = (
        db_session.query(MarketData)
        .filter(MarketData.ticker == sample_ticker.symbol)
        .all()
    )
    # Original 3 rows still present.
    assert len(rows) == 3


# ── Bulk fetch / chunked force-refresh ──


def _multi_history_frame(symbols_to_prices: dict[str, list[float]]) -> pd.DataFrame:
    """Build a yfinance-style multi-symbol history frame (group_by='ticker')."""
    if not symbols_to_prices:
        return pd.DataFrame()
    n = len(next(iter(symbols_to_prices.values())))
    dates = pd.DatetimeIndex(
        [date(2024, 1, 2 + i) for i in range(n)]
    )
    cols = pd.MultiIndex.from_product(
        [list(symbols_to_prices.keys()), ["Open", "High", "Low", "Close", "Volume"]]
    )
    rows = []
    for i in range(n):
        row = []
        for sym in symbols_to_prices:
            p = symbols_to_prices[sym][i]
            row.extend([p, p, p, p, 1000])
        rows.append(row)
    return pd.DataFrame(rows, columns=cols, index=dates)


@patch("asistrader.services.market_data_service.yf.download")
def test_bulk_fetch_uses_one_call_for_multiple_symbols(
    mock_download: MagicMock, db_session: Session
) -> None:
    """yf.download is called once for a chunk of symbols, not once per symbol."""
    mock_download.return_value = _multi_history_frame(
        {"AAA": [100.0, 101.0], "BBB": [50.0, 51.0]}
    )

    counts = market_data_service.bulk_fetch_and_store(
        db_session, ["AAA", "BBB"], date(2024, 1, 2), date(2024, 1, 3)
    )

    assert mock_download.call_count == 1
    assert counts["AAA"] == 2
    assert counts["BBB"] == 2


@patch("asistrader.services.market_data_service.time.sleep")
@patch("asistrader.services.market_data_service.yf.download")
def test_bulk_fetch_chunks_with_cooldown(
    mock_download: MagicMock,
    mock_sleep: MagicMock,
    db_session: Session,
) -> None:
    """50 symbols at chunk_size=20 → 3 download calls + 2 cool-off sleeps."""
    symbols = [f"S{i}" for i in range(50)]

    def fake_download(tickers, **_kwargs):
        return _multi_history_frame({sym: [100.0] for sym in tickers})

    mock_download.side_effect = fake_download

    market_data_service.bulk_fetch_and_store(
        db_session,
        symbols,
        date(2024, 1, 2),
        date(2024, 1, 2),
        chunk_size=20,
        delay_between_chunks=2.0,
    )

    expected_chunks = (50 + 20 - 1) // 20  # = 3
    assert mock_download.call_count == expected_chunks
    # Sleep fires AFTER all chunks except the last.
    assert mock_sleep.call_count == expected_chunks - 1
    for call in mock_sleep.call_args_list:
        assert call.args[0] == 2.0


@patch("asistrader.services.market_data_service.bulk_fetch_and_store")
def test_sync_all_force_refresh_routes_through_bulk(
    mock_bulk: MagicMock,
    db_session: Session,
    sample_ticker: Ticker,
    sample_market_data: list[MarketData],
) -> None:
    """force_refresh=True wipes existing rows and calls the bulk path,
    NOT the per-ticker sync_ticker loop."""
    mock_bulk.return_value = {sample_ticker.symbol: 5}

    market_data_service.sync_all(
        db_session,
        date(2024, 1, 1),
        symbols=[sample_ticker.symbol],
        force_refresh=True,
    )

    # Existing 3 rows wiped before the bulk fetch ran. The mock didn't
    # actually store anything, so the table is empty post-call.
    remaining = (
        db_session.query(MarketData)
        .filter(MarketData.ticker == sample_ticker.symbol)
        .count()
    )
    assert remaining == 0

    assert mock_bulk.call_count == 1
    # The bulk function received the symbol list verbatim.
    args, kwargs = mock_bulk.call_args
    passed_symbols = kwargs.get("symbols", args[1] if len(args) > 1 else None)
    assert passed_symbols == [sample_ticker.symbol]
