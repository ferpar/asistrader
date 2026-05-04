"""Tests for the batch /prices implementation.

Verifies that get_batch_prices makes a single yfinance call (not N) and
correctly extracts close prices from both single and multi-symbol returns.
Currency is sourced from the local tickers table.
"""

from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
from sqlalchemy.orm import Session

from asistrader.models.db import Bias, Strategy, Ticker
from asistrader.services import ticker_service
from asistrader.services.ticker_service import (
    PRICE_CHUNK_SIZE,
    _clear_price_cache,
    get_batch_prices,
)


@pytest.fixture(autouse=True)
def _clear_cache() -> None:
    _clear_price_cache()
    yield
    _clear_price_cache()


@pytest.fixture
def two_tickers(db_session: Session, sample_strategy: Strategy) -> None:
    db_session.add_all([
        Ticker(
            symbol="ASML", currency="EUR", bias=Bias.LONG,
            horizon="swing", strategy_id=sample_strategy.id,
        ),
        Ticker(
            symbol="NVDA", currency="USD", bias=Bias.LONG,
            horizon="swing", strategy_id=sample_strategy.id,
        ),
    ])
    db_session.commit()


def _multi_frame(prices: dict[str, float]) -> pd.DataFrame:
    """Build a yfinance-style multi-symbol DataFrame (group_by='ticker')."""
    cols = pd.MultiIndex.from_product(
        [list(prices.keys()), ["Open", "High", "Low", "Close", "Volume"]]
    )
    row = []
    for sym in prices:
        p = prices[sym]
        row.extend([p, p, p, p, 1000])
    return pd.DataFrame([row], columns=cols, index=pd.DatetimeIndex(["2026-05-04"]))


def _single_frame(price: float) -> pd.DataFrame:
    """Build a yfinance-style single-symbol DataFrame."""
    return pd.DataFrame(
        {
            "Open": [price], "High": [price], "Low": [price],
            "Close": [price], "Volume": [1000],
        },
        index=pd.DatetimeIndex(["2026-05-04"]),
    )


@patch("asistrader.services.ticker_service.yf.download")
def test_makes_one_call_for_many_symbols(
    mock_download: MagicMock, db_session: Session, two_tickers: None
) -> None:
    """N symbols → exactly one yf.download call (not N fast_info calls)."""
    mock_download.return_value = _multi_frame({"ASML": 850.0, "NVDA": 130.0})

    get_batch_prices(["ASML", "NVDA"], db=db_session)

    assert mock_download.call_count == 1


@patch("asistrader.services.ticker_service.yf.download")
def test_returns_close_prices_with_currency_from_db(
    mock_download: MagicMock, db_session: Session, two_tickers: None
) -> None:
    mock_download.return_value = _multi_frame({"ASML": 850.0, "NVDA": 130.0})

    out = get_batch_prices(["ASML", "NVDA"], db=db_session)

    assert out["ASML"]["price"] == pytest.approx(850.0)
    assert out["ASML"]["currency"] == "EUR"
    assert out["ASML"]["valid"] is True
    assert out["NVDA"]["price"] == pytest.approx(130.0)
    assert out["NVDA"]["currency"] == "USD"


@patch("asistrader.services.ticker_service.yf.download")
def test_single_symbol_handles_flat_frame(
    mock_download: MagicMock, db_session: Session, two_tickers: None
) -> None:
    """yf.download with a single symbol returns a flat OHLCV frame, not multi-index."""
    mock_download.return_value = _single_frame(850.0)

    out = get_batch_prices(["ASML"], db=db_session)

    assert out["ASML"]["price"] == pytest.approx(850.0)
    assert out["ASML"]["valid"] is True


@patch("asistrader.services.ticker_service.yf.download")
def test_uppercases_input_symbols(
    mock_download: MagicMock, db_session: Session, two_tickers: None
) -> None:
    mock_download.return_value = _multi_frame({"ASML": 850.0, "NVDA": 130.0})

    out = get_batch_prices(["asml", "nvda"], db=db_session)

    assert "ASML" in out and "NVDA" in out
    assert "asml" not in out


@patch("asistrader.services.ticker_service.yf.download")
def test_empty_response_marks_all_invalid(
    mock_download: MagicMock, db_session: Session, two_tickers: None
) -> None:
    mock_download.return_value = pd.DataFrame()

    out = get_batch_prices(["ASML", "NVDA"], db=db_session)

    assert out["ASML"]["valid"] is False
    assert out["NVDA"]["valid"] is False


@patch("asistrader.services.ticker_service.yf.download")
def test_yfinance_failure_returns_invalid_results(
    mock_download: MagicMock, db_session: Session, two_tickers: None
) -> None:
    mock_download.side_effect = Exception("yfinance is down")

    out = get_batch_prices(["ASML", "NVDA"], db=db_session)

    assert out["ASML"]["valid"] is False
    assert out["NVDA"]["valid"] is False


@patch("asistrader.services.ticker_service.yf.download")
def test_partial_data_when_some_symbols_missing(
    mock_download: MagicMock, db_session: Session, two_tickers: None
) -> None:
    """yfinance returned data for ASML but not NVDA — return what we have."""
    mock_download.return_value = _multi_frame({"ASML": 850.0})

    out = get_batch_prices(["ASML", "NVDA"], db=db_session)

    assert out["ASML"]["valid"] is True
    assert out["NVDA"]["valid"] is False


def test_empty_input_returns_empty_dict(db_session: Session) -> None:
    assert get_batch_prices([], db=db_session) == {}


# ── Chunking + caching at scale ──


@patch("asistrader.services.ticker_service.yf.download")
def test_chunks_large_symbol_lists(
    mock_download: MagicMock,
    db_session: Session,
    sample_strategy: Strategy,
) -> None:
    """50 symbols → multiple yf.download calls, each ≤ PRICE_CHUNK_SIZE."""
    symbols = [f"TKR{i}" for i in range(50)]
    db_session.add_all([
        Ticker(
            symbol=s, currency="USD", bias=Bias.LONG,
            horizon="swing", strategy_id=sample_strategy.id,
        )
        for s in symbols
    ])
    db_session.commit()

    # Each call returns a multi-index frame for whatever chunk it received.
    def fake_download(tickers, **_kwargs):
        prices = {sym: 100.0 for sym in tickers}
        cols = pd.MultiIndex.from_product(
            [list(prices.keys()), ["Open", "High", "Low", "Close", "Volume"]]
        )
        row = []
        for sym in prices:
            p = prices[sym]
            row.extend([p, p, p, p, 1000])
        return pd.DataFrame([row], columns=cols, index=pd.DatetimeIndex(["2026-05-04"]))

    mock_download.side_effect = fake_download

    out = get_batch_prices(symbols, db=db_session)

    # 50 / 20 = 3 chunks (20 + 20 + 10).
    expected_chunks = (50 + PRICE_CHUNK_SIZE - 1) // PRICE_CHUNK_SIZE
    assert mock_download.call_count == expected_chunks
    # Every requested symbol came back valid.
    assert all(out[s]["valid"] for s in symbols)


@patch("asistrader.services.ticker_service.yf.download")
def test_repeat_call_within_ttl_is_a_full_cache_hit(
    mock_download: MagicMock,
    db_session: Session,
    two_tickers: None,
) -> None:
    mock_download.return_value = _multi_frame({"ASML": 850.0, "NVDA": 130.0})

    get_batch_prices(["ASML", "NVDA"], db=db_session)
    assert mock_download.call_count == 1

    # Second call within TTL should hit cache, not yfinance.
    out = get_batch_prices(["ASML", "NVDA"], db=db_session)
    assert mock_download.call_count == 1  # unchanged
    assert out["ASML"]["price"] == pytest.approx(850.0)


@patch("asistrader.services.ticker_service.yf.download")
def test_partial_cache_hit_only_fetches_missing(
    mock_download: MagicMock,
    db_session: Session,
    two_tickers: None,
) -> None:
    """Cached symbols are served from memory; only the unknown one hits yf."""
    # Prime the cache for ASML only — single-symbol chunks see a flat frame.
    mock_download.return_value = _single_frame(850.0)
    get_batch_prices(["ASML"], db=db_session)
    assert mock_download.call_count == 1

    # Now request both — only NVDA should trigger a fetch (single-symbol
    # chunk returns a flat OHLCV frame, matching yfinance's actual shape).
    mock_download.reset_mock()
    mock_download.return_value = _single_frame(130.0)
    out = get_batch_prices(["ASML", "NVDA"], db=db_session)

    assert mock_download.call_count == 1
    args, kwargs = mock_download.call_args
    fetched_chunk = kwargs.get("tickers", args[0] if args else None)
    assert fetched_chunk == ["NVDA"]  # ASML wasn't re-fetched
    assert out["ASML"]["price"] == pytest.approx(850.0)
    assert out["NVDA"]["price"] == pytest.approx(130.0)


@patch("asistrader.services.ticker_service.time.monotonic")
@patch("asistrader.services.ticker_service.yf.download")
def test_cache_expires_after_ttl(
    mock_download: MagicMock,
    mock_monotonic: MagicMock,
    db_session: Session,
    two_tickers: None,
) -> None:
    mock_download.return_value = _multi_frame({"ASML": 850.0, "NVDA": 130.0})

    # First fetch at t=0.
    mock_monotonic.return_value = 0.0
    get_batch_prices(["ASML", "NVDA"], db=db_session)
    assert mock_download.call_count == 1

    # Past TTL → cache misses, refetches.
    mock_monotonic.return_value = ticker_service.PRICE_CACHE_TTL_SECONDS + 1
    mock_download.reset_mock()
    mock_download.return_value = _multi_frame({"ASML": 851.0, "NVDA": 131.0})
    out = get_batch_prices(["ASML", "NVDA"], db=db_session)

    assert mock_download.call_count == 1
    assert out["ASML"]["price"] == pytest.approx(851.0)


@patch("asistrader.services.ticker_service.yf.download")
def test_invalid_responses_are_not_cached(
    mock_download: MagicMock,
    db_session: Session,
    two_tickers: None,
) -> None:
    """Transient failures should be retried on next call, not stuck in cache."""
    mock_download.return_value = pd.DataFrame()  # empty → all invalid

    get_batch_prices(["ASML", "NVDA"], db=db_session)
    assert mock_download.call_count == 1

    # Second call: still no valid cache → refetches.
    mock_download.reset_mock()
    mock_download.return_value = _multi_frame({"ASML": 850.0, "NVDA": 130.0})
    out = get_batch_prices(["ASML", "NVDA"], db=db_session)
    assert mock_download.call_count == 1
    assert out["ASML"]["valid"] is True
