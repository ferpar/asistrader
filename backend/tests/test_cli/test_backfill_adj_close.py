"""Tests for `asistrader.cli.backfill_adj_close`, wired to the in-memory
session, with Yahoo mocked. Effects are observed through the bulk market-data
API."""

from datetime import date
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from asistrader.cli.backfill_adj_close import main
from asistrader.models.db import MarketData, Ticker

pytestmark = pytest.mark.usefixtures("signed_in")


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
def test_fills_adjusted_closes_of_existing_rows(
    mock_fetch: MagicMock,
    client: TestClient,
    db_session: Session,
    capsys: pytest.CaptureFixture[str],
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

    assert main([], session=db_session) == 0

    assert "KO: 2 rows" in capsys.readouterr().out
    assert [call.args[0] for call in mock_fetch.call_args_list] == ["KO"]
    data = client.post(
        "/api/market-data/bulk", json={"symbols": ["KO", "PEP"], "start_date": "2024-01-01"}
    ).json()["data"]
    assert data["KO"]["adj_close"] == [55.2, 56.1]
    assert data["KO"]["close"] == [60.0, 61.0]
    assert data["PEP"]["adj_close"] == [160.0]


@patch("asistrader.services.market_data_service.fetch_from_yfinance")
def test_reports_per_symbol_errors(
    mock_fetch: MagicMock,
    client: TestClient,
    db_session: Session,
    capsys: pytest.CaptureFixture[str],
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

    assert main([], session=db_session) == 1

    captured = capsys.readouterr()
    assert "KO: 1 rows" in captured.out
    assert "BAD: error: yahoo down" in captured.err
