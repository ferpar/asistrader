"""Un-fillable backward gaps must not be re-requested on every sync.

Yahoo has no history before a certain date for some listings. Gap detection
asks for the missing range, gets nothing back, stores nothing — and asks again
next time. Production logs showed ~6.3k such fetches from nine symbols, each
one holding a worker thread and a pooled DB connection on a network call that
could never succeed.
"""

from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

import pandas as pd
import pytest
from sqlalchemy.orm import Session

from asistrader.models.db import MarketData, Ticker
from asistrader.services import market_data_service


def _ohlc(days: list[date]) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "Open": [1.0] * len(days),
            "High": [1.0] * len(days),
            "Low": [1.0] * len(days),
            "Close": [1.0] * len(days),
            "Volume": [0] * len(days),
        },
        index=pd.DatetimeIndex(days),
    )


@pytest.fixture
def ticker_with_recent_data(db_session: Session) -> Ticker:
    """A ticker holding only recent bars, so a backward gap exists.

    Mirrors the production shape: current data present, but nothing before it.
    """
    ticker = Ticker(symbol="SPCX")
    db_session.add(ticker)
    today = date.today()
    for offset in range(3):
        db_session.add(
            MarketData(
                ticker="SPCX",
                date=today - timedelta(days=offset + 1),
                open=1.0, high=1.0, low=1.0, close=1.0, volume=0,
            )
        )
    db_session.commit()
    return ticker


def test_empty_backfill_is_recorded(
    db_session: Session, ticker_with_recent_data: Ticker
) -> None:
    """A backward fetch that returns nothing stamps the ticker."""
    start = date.today() - timedelta(days=365)

    with patch(
        "asistrader.services.market_data_service.fetch_from_yfinance"
    ) as mock_fetch:
        mock_fetch.return_value = pd.DataFrame()
        market_data_service.sync_ticker(db_session, "SPCX", start)

    db_session.refresh(ticker_with_recent_data)
    assert ticker_with_recent_data.backfill_exhausted_at is not None


def test_second_sync_skips_the_dead_backward_range(
    db_session: Session, ticker_with_recent_data: Ticker
) -> None:
    """The whole point: the second sync must not repeat the futile fetch."""
    start = date.today() - timedelta(days=365)

    with patch(
        "asistrader.services.market_data_service.fetch_from_yfinance"
    ) as mock_fetch:
        mock_fetch.return_value = pd.DataFrame()
        market_data_service.sync_ticker(db_session, "SPCX", start)
        first_pass_calls = mock_fetch.call_count

        mock_fetch.reset_mock()
        market_data_service.sync_ticker(db_session, "SPCX", start)

        assert first_pass_calls >= 1, "first sync should have attempted the backfill"
        assert mock_fetch.call_count == 0, (
            "second sync re-requested a range already known to be empty"
        )


def test_an_even_earlier_start_date_is_still_skipped(
    db_session: Session, ticker_with_recent_data: Ticker
) -> None:
    """Nothing exists before our earliest bar, so reaching further back is
    equally futile — the marker must cover that case too."""
    with patch(
        "asistrader.services.market_data_service.fetch_from_yfinance"
    ) as mock_fetch:
        mock_fetch.return_value = pd.DataFrame()
        market_data_service.sync_ticker(
            db_session, "SPCX", date.today() - timedelta(days=365)
        )
        mock_fetch.reset_mock()
        market_data_service.sync_ticker(
            db_session, "SPCX", date.today() - timedelta(days=3650)
        )

    assert mock_fetch.call_count == 0


def test_marker_expires_so_extended_history_is_eventually_found(
    db_session: Session, ticker_with_recent_data: Ticker
) -> None:
    """A stale marker is re-probed, bounding the cost of a genuinely extended
    history to one call a month rather than blocking it forever."""
    start = date.today() - timedelta(days=365)
    stale = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
        days=market_data_service.BACKFILL_RETRY_DAYS + 1
    )
    ticker_with_recent_data.backfill_exhausted_at = stale
    db_session.commit()

    with patch(
        "asistrader.services.market_data_service.fetch_from_yfinance"
    ) as mock_fetch:
        mock_fetch.return_value = pd.DataFrame()
        market_data_service.sync_ticker(db_session, "SPCX", start)

    assert mock_fetch.call_count >= 1


def test_successful_backfill_clears_the_marker(
    db_session: Session, ticker_with_recent_data: Ticker
) -> None:
    """Rows landing means the history does reach back — drop the marker."""
    ticker_with_recent_data.backfill_exhausted_at = None
    db_session.commit()
    start = date.today() - timedelta(days=365)

    with patch(
        "asistrader.services.market_data_service.fetch_from_yfinance"
    ) as mock_fetch:
        mock_fetch.return_value = _ohlc([date.today() - timedelta(days=200)])
        market_data_service.sync_ticker(db_session, "SPCX", start)

    db_session.refresh(ticker_with_recent_data)
    assert ticker_with_recent_data.backfill_exhausted_at is None


def test_forward_gap_still_syncs_while_backward_is_exhausted(
    db_session: Session, ticker_with_recent_data: Ticker
) -> None:
    """Regression guard: the marker must only suppress the backward fetch.

    These tickers are live — suppressing their forward sync would stop price
    updates entirely.
    """
    db_session.query(MarketData).filter(MarketData.ticker == "SPCX").delete()
    old_bar = date.today() - timedelta(days=30)
    db_session.add(
        MarketData(ticker="SPCX", date=old_bar, open=1.0, high=1.0, low=1.0, close=1.0, volume=0)
    )
    ticker_with_recent_data.backfill_exhausted_at = datetime.now(
        timezone.utc
    ).replace(tzinfo=None)
    db_session.commit()

    with patch(
        "asistrader.services.market_data_service.fetch_from_yfinance"
    ) as mock_fetch:
        mock_fetch.return_value = _ohlc([date.today() - timedelta(days=1)])
        market_data_service.sync_ticker(
            db_session, "SPCX", date.today() - timedelta(days=365)
        )

    assert mock_fetch.call_count == 1, "forward gap should still have been fetched"
    fetch_start = mock_fetch.call_args[0][1]
    assert fetch_start > old_bar, "the one fetch should be the forward one"


def test_force_refresh_resets_the_marker(
    db_session: Session, ticker_with_recent_data: Ticker
) -> None:
    """Wiping and re-fetching re-establishes the bounds from scratch."""
    ticker_with_recent_data.backfill_exhausted_at = datetime.now(
        timezone.utc
    ).replace(tzinfo=None)
    db_session.commit()

    with patch(
        "asistrader.services.market_data_service.fetch_from_yfinance"
    ) as mock_fetch:
        mock_fetch.return_value = _ohlc([date.today() - timedelta(days=1)])
        market_data_service.sync_ticker(
            db_session, "SPCX", date.today() - timedelta(days=365), force_refresh=True
        )

    db_session.refresh(ticker_with_recent_data)
    assert ticker_with_recent_data.backfill_exhausted_at is None
