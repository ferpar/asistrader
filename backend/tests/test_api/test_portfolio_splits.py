"""Portfolio API: splits are applied automatically.

Stored closes are split-adjusted (Yahoo's `Close`, ADR 0002), and a split
event of an instrument is stored per ticker by the market-data sync. A Lot
bought before a split is expressed in the same split-adjusted basis, so the
Transactions keep the units and prices the user entered while Portfolio
Value stays continuous and the Performance Index ignores the split.

Tests stay at the HTTP seam: seed tickers, closes and split events directly
(or through a mocked yfinance sync) and assert only on what the API returns.
"""

from datetime import date
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from asistrader.models.db import MarketData, Ticker, TickerSplit

pytestmark = pytest.mark.usefixtures("signed_in")

# A 2-for-1 split on Thursday 2024-01-04. The stored closes are Yahoo's
# split-adjusted ones: flat at 60 on both sides, though the real price the
# user paid before the split was 120.
SPLIT_DAY = date(2024, 1, 4)
FLAT_ADJUSTED = {
    date(2024, 1, 2): 60.0,
    date(2024, 1, 3): 60.0,
    date(2024, 1, 4): 60.0,
    date(2024, 1, 5): 60.0,
}


def _seed_ticker(
    db: Session,
    symbol: str,
    closes: dict[date, float],
    splits: dict[date, float] | None = None,
) -> None:
    db.add(Ticker(symbol=symbol, currency="USD", price_hint=2))
    db.add_all(
        MarketData(ticker=symbol, date=d, open=c, high=c, low=c, close=c, volume=0)
        for d, c in closes.items()
    )
    db.add_all(
        TickerSplit(ticker=symbol, date=d, ratio=r) for d, r in (splits or {}).items()
    )
    db.commit()


def _portfolio(client: TestClient) -> int:
    response = client.post("/api/portfolios", json={"name": "US", "currency": "USD"})
    assert response.status_code == 201, response.text
    return response.json()["portfolio"]["id"]


def _post(client: TestClient, pid: int, **fields):
    return client.post(f"/api/portfolios/{pid}/transactions", json={"fees": 0, **fields})


def _record(client: TestClient, pid: int, **fields) -> dict:
    response = _post(client, pid, **fields)
    assert response.status_code == 201, response.text
    return response.json()["transaction"]


def _summary(client: TestClient, pid: int) -> dict:
    response = client.get(f"/api/portfolios/{pid}/summary")
    assert response.status_code == 200, response.text
    return response.json()


def _history(client: TestClient, pid: int, **params) -> dict:
    response = client.get(f"/api/portfolios/{pid}/history", params=params)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def nvda(client: TestClient, db_session: Session) -> int:
    """A USD Portfolio that bought 10 NVDA at 120 on 01-02, before the split."""
    _seed_ticker(db_session, "NVDA", FLAT_ADJUSTED, {SPLIT_DAY: 2.0})
    pid = _portfolio(client)
    _record(client, pid, kind="buy", date="2024-01-02", ticker="NVDA", units=10, price=120)
    return pid


class TestAutomaticSplits:
    def test_value_is_continuous_across_a_split(
        self, client: TestClient, nvda: int
    ) -> None:
        history = _history(client, nvda, to="2024-01-05")

        assert history["dates"] == ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"]
        assert history["portfolio_value"] == pytest.approx([1200.0] * 4)
        assert history["invested"] == pytest.approx([1200.0] * 4)
        assert history["unrealized_gain"] == pytest.approx([0.0] * 4)

    def test_the_summary_shows_the_split_adjusted_units(
        self, client: TestClient, nvda: int
    ) -> None:
        summary = _summary(client, nvda)

        holding = summary["holdings"][0]
        assert holding["units"] == pytest.approx(20.0)
        assert holding["last_price"] == pytest.approx(60.0)
        assert summary["invested"] == pytest.approx(1200.0)
        assert summary["portfolio_value"] == pytest.approx(1200.0)

    def test_the_transaction_keeps_the_units_and_price_entered(
        self, client: TestClient, nvda: int
    ) -> None:
        listed = client.get(f"/api/portfolios/{nvda}/transactions").json()["transactions"]

        assert listed[0]["units"] == pytest.approx(10.0)
        assert listed[0]["price"] == pytest.approx(120.0)

    def test_a_later_sell_of_post_split_units_works(
        self, client: TestClient, nvda: int
    ) -> None:
        _record(client, nvda, kind="sell", date="2024-01-05", ticker="NVDA", units=15, price=66)

        summary = _summary(client, nvda)
        assert summary["holdings"][0]["units"] == pytest.approx(5.0)
        # 15 of the Lot's 20 split-adjusted units: 3/4 of its 1200 cost.
        assert summary["invested"] == pytest.approx(300.0)
        assert summary["realized_gain"] == pytest.approx(15 * 66 - 900.0)

    def test_selling_more_than_the_post_split_units_is_rejected(
        self, client: TestClient, nvda: int
    ) -> None:
        response = _post(
            client, nvda, kind="sell", date="2024-01-05", ticker="NVDA", units=20.5, price=60
        )

        assert response.status_code == 422
        assert "exceeds" in response.json()["detail"]

    def test_a_sell_before_the_split_is_in_pre_split_units(
        self, client: TestClient, nvda: int
    ) -> None:
        _record(client, nvda, kind="sell", date="2024-01-03", ticker="NVDA", units=4, price=120)

        summary = _summary(client, nvda)
        # 6 pre-split units left = 12 split-adjusted units.
        assert summary["holdings"][0]["units"] == pytest.approx(12.0)
        assert summary["invested"] == pytest.approx(720.0)
        assert summary["realized_gain"] == pytest.approx(0.0)

    def test_a_buy_on_or_after_the_split_day_is_not_multiplied(
        self, client: TestClient, nvda: int
    ) -> None:
        _record(client, nvda, kind="buy", date="2024-01-04", ticker="NVDA", units=5, price=60)

        summary = _summary(client, nvda)
        assert summary["holdings"][0]["units"] == pytest.approx(25.0)
        assert summary["portfolio_value"] == pytest.approx(1500.0)

    def test_the_performance_index_is_flat_across_a_split_on_flat_prices(
        self, client: TestClient, nvda: int
    ) -> None:
        history = _history(client, nvda, to="2024-01-05")

        assert history["performance_index"] == pytest.approx([100.0] * 4)

    def test_weighted_days_open_keeps_the_buy_date(
        self, client: TestClient, nvda: int
    ) -> None:
        history = _history(client, nvda, to="2024-01-05")

        assert history["weighted_days_open"] == pytest.approx([0.0, 1.0, 2.0, 3.0])

    def test_without_a_close_the_price_is_split_adjusted(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "FRESH", {}, {date(2024, 1, 3): 4.0})
        pid = _portfolio(client)
        _record(client, pid, kind="buy", date="2024-01-02", ticker="FRESH", units=10, price=100)

        summary = _summary(client, pid)
        assert summary["holdings"][0]["units"] == pytest.approx(40.0)
        assert summary["holdings"][0]["last_price"] == pytest.approx(25.0)
        assert summary["portfolio_value"] == pytest.approx(1000.0)

    def test_split_is_not_a_transaction_kind(self, client: TestClient, nvda: int) -> None:
        response = _post(
            client, nvda, kind="split", date="2024-01-04", ticker="NVDA", split_ratio=2
        )

        assert response.status_code == 422
        assert client.get(f"/api/portfolios/{nvda}/transactions").json()["count"] == 1


def _frame(days: list[date], closes: list[float], splits: list[float]) -> pd.DataFrame:
    """A yfinance `history()` frame (auto_adjust=False) with a Stock Splits column."""
    return pd.DataFrame(
        {
            "Open": closes,
            "High": closes,
            "Low": closes,
            "Close": closes,
            "Adj Close": closes,
            "Volume": [1000] * len(days),
            "Dividends": [0.0] * len(days),
            "Stock Splits": splits,
        },
        index=pd.DatetimeIndex(days),
    )


class TestSyncedSplits:
    @patch("asistrader.services.market_data_service.fetch_from_yfinance")
    def test_sync_stores_the_split_events_yahoo_reports(
        self, mock_fetch: MagicMock, client: TestClient, db_session: Session
    ) -> None:
        db_session.add(Ticker(symbol="NVDA", currency="USD", price_hint=2))
        db_session.commit()
        days = list(FLAT_ADJUSTED)
        mock_fetch.return_value = _frame(days, [60.0] * 4, [0.0, 0.0, 2.0, 0.0])
        response = client.post(
            "/api/market-data/sync-all", json={"start_date": "2024-01-02", "symbols": ["NVDA"]}
        )
        assert response.status_code == 200
        pid = _portfolio(client)

        _record(client, pid, kind="buy", date="2024-01-02", ticker="NVDA", units=10, price=120)

        assert _summary(client, pid)["holdings"][0]["units"] == pytest.approx(20.0)
