"""Portfolio API: Split Transactions.

A Split multiplies the units of every open Lot of a ticker by its ratio and
leaves their cost unchanged, so a stock split doesn't look like a crash in
Portfolio Value. Tests stay at the HTTP seam: seed tickers and market data
directly and assert only on what the API returns.
"""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from asistrader.models.db import MarketData, Ticker

pytestmark = pytest.mark.usefixtures("signed_in")


def _seed_ticker(db: Session, symbol: str, closes: dict[date, float]) -> None:
    db.add(Ticker(symbol=symbol, currency="USD", price_hint=2))
    db.add_all(
        MarketData(ticker=symbol, date=d, open=c, high=c, low=c, close=c, volume=0)
        for d, c in closes.items()
    )
    db.commit()


def _post(client: TestClient, pid: int, **fields):
    return client.post(f"/api/portfolios/{pid}/transactions", json=fields)


def _record(client: TestClient, pid: int, **fields) -> dict:
    response = _post(client, pid, **fields)
    assert response.status_code == 201, response.text
    return response.json()["transaction"]


def _summary(client: TestClient, pid: int) -> dict:
    response = client.get(f"/api/portfolios/{pid}/summary")
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def nvda(client: TestClient, db_session: Session) -> int:
    """A USD Portfolio holding two NVDA Lots: 10 @ 100 on 01-02 and 10 @ 110
    on 01-03. The raw close halves on 01-08, the day of a 2-for-1 Split."""
    _seed_ticker(
        db_session,
        "NVDA",
        {date(2024, 1, 2): 100.0, date(2024, 1, 5): 120.0, date(2024, 1, 8): 60.0},
    )
    response = client.post("/api/portfolios", json={"name": "US", "currency": "USD"})
    pid = response.json()["portfolio"]["id"]
    _record(client, pid, kind="buy", date="2024-01-02", ticker="NVDA", units=10, price=100)
    _record(client, pid, kind="buy", date="2024-01-03", ticker="NVDA", units=10, price=110)
    return pid


class TestSplits:
    def test_split_multiplies_units_and_keeps_cost_and_value(
        self, client: TestClient, nvda: int
    ) -> None:
        before = _summary(client, nvda)
        assert before["holdings"][0]["units"] == pytest.approx(20.0)

        split = _record(
            client, nvda, kind="split", date="2024-01-08", ticker="NVDA", split_ratio=2
        )

        assert split["kind"] == "split"
        assert split["split_ratio"] == pytest.approx(2.0)
        assert split["units"] is None
        assert split["price"] is None
        after = _summary(client, nvda)
        holding = after["holdings"][0]
        assert holding["units"] == pytest.approx(40.0)
        assert after["invested"] == pytest.approx(2100.0)
        # 40 split-adjusted units × the halved close 60 = 20 × 120 before it.
        assert after["portfolio_value"] == pytest.approx(2400.0)
        assert after["unrealized_gain"] == pytest.approx(300.0)

    def test_later_sells_consume_split_adjusted_units_fifo(
        self, client: TestClient, nvda: int
    ) -> None:
        _record(client, nvda, kind="split", date="2024-01-08", ticker="NVDA", split_ratio=2)

        # 30 units: the whole first Lot (now 20 units, cost 1000) + half the
        # second (10 of its 20 units, cost 550).
        _record(
            client, nvda, kind="sell", date="2024-01-09", ticker="NVDA", units=30, price=70
        )

        summary = _summary(client, nvda)
        assert summary["holdings"][0]["units"] == pytest.approx(10.0)
        assert summary["invested"] == pytest.approx(550.0)
        # Proceeds 30 × 70 = 2100 − consumed cost 1550.
        assert summary["realized_gain"] == pytest.approx(550.0)

    def test_selling_more_than_the_split_adjusted_units_is_rejected(
        self, client: TestClient, nvda: int
    ) -> None:
        _record(client, nvda, kind="split", date="2024-01-08", ticker="NVDA", split_ratio=2)

        response = _post(
            client, nvda, kind="sell", date="2024-01-09", ticker="NVDA", units=40.5, price=70
        )

        assert response.status_code == 422
        assert "exceeds" in response.json()["detail"]

    def test_split_of_a_ticker_not_held_is_rejected(
        self, client: TestClient, db_session: Session, nvda: int
    ) -> None:
        _seed_ticker(db_session, "AAPL", {date(2024, 1, 2): 180.0})

        for symbol in ("AAPL", "UNKNOWN"):
            response = _post(
                client, nvda, kind="split", date="2024-01-08", ticker=symbol, split_ratio=4
            )
            assert response.status_code == 422, symbol
            assert "held" in response.json()["detail"]
        # Before the first Buy nothing is held either.
        response = _post(
            client, nvda, kind="split", date="2024-01-01", ticker="NVDA", split_ratio=2
        )
        assert response.status_code == 422
        assert client.get(f"/api/portfolios/{nvda}/transactions").json()["count"] == 2

    def test_split_after_selling_everything_is_rejected(
        self, client: TestClient, nvda: int
    ) -> None:
        _record(client, nvda, kind="sell", date="2024-01-05", ticker="NVDA", units=20, price=120)

        response = _post(
            client, nvda, kind="split", date="2024-01-08", ticker="NVDA", split_ratio=2
        )

        assert response.status_code == 422

    @pytest.mark.parametrize(
        "fields",
        [
            {},
            {"split_ratio": 0},
            {"split_ratio": -2},
            {"split_ratio": 2, "units": 10},
            {"split_ratio": 2, "price": 50},
            {"split_ratio": 2, "fx_rate": 1.1},
            {"split_ratio": 2, "fees": 1},
        ],
        ids=["missing", "zero", "negative", "units", "price", "fx_rate", "fees"],
    )
    def test_invalid_splits_are_rejected(
        self, client: TestClient, nvda: int, fields: dict
    ) -> None:
        response = _post(
            client, nvda, kind="split", date="2024-01-08", ticker="NVDA", **fields
        )

        assert response.status_code == 422
        assert client.get(f"/api/portfolios/{nvda}/transactions").json()["count"] == 2

    def test_buys_and_sells_take_no_split_ratio(self, client: TestClient, nvda: int) -> None:
        response = _post(
            client,
            nvda,
            kind="buy",
            date="2024-01-08",
            ticker="NVDA",
            units=1,
            price=60,
            split_ratio=2,
        )

        assert response.status_code == 422

    @pytest.mark.parametrize("missing", ["units", "price"])
    def test_buys_and_sells_still_need_units_and_price(
        self, client: TestClient, nvda: int, missing: str
    ) -> None:
        fields = {k: v for k, v in {"units": 1, "price": 60}.items() if k != missing}

        response = _post(client, nvda, kind="sell", date="2024-01-08", ticker="NVDA", **fields)

        assert response.status_code == 422

    def test_value_without_a_close_since_the_split_uses_the_split_adjusted_price(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "FRESH", {})
        created = client.post("/api/portfolios", json={"name": "F", "currency": "USD"})
        pid = created.json()["portfolio"]["id"]
        _record(client, pid, kind="buy", date="2024-01-02", ticker="FRESH", units=10, price=100)

        _record(client, pid, kind="split", date="2024-01-03", ticker="FRESH", split_ratio=4)

        summary = _summary(client, pid)
        assert summary["holdings"][0]["units"] == pytest.approx(40.0)
        assert summary["holdings"][0]["last_price"] == pytest.approx(25.0)
        assert summary["portfolio_value"] == pytest.approx(1000.0)


def _put(client: TestClient, pid: int, tx_id: int, **fields):
    return client.put(f"/api/portfolios/{pid}/transactions/{tx_id}", json=fields)


def _split(client: TestClient, pid: int, ratio: float, on: str = "2024-01-08") -> dict:
    return _record(client, pid, kind="split", date=on, ticker="NVDA", split_ratio=ratio)


class TestEditingSplits:
    def test_editing_the_ratio_recomputes_the_units(
        self, client: TestClient, nvda: int
    ) -> None:
        split = _split(client, nvda, 2)

        response = _put(
            client, nvda, split["id"], kind="split", date="2024-01-08", ticker="NVDA", split_ratio=3
        )

        assert response.status_code == 200, response.text
        assert response.json()["transaction"]["split_ratio"] == pytest.approx(3.0)
        assert _summary(client, nvda)["holdings"][0]["units"] == pytest.approx(60.0)

    def test_shrinking_the_ratio_below_a_later_sell_is_rejected(
        self, client: TestClient, nvda: int
    ) -> None:
        split = _split(client, nvda, 2)
        _record(client, nvda, kind="sell", date="2024-01-09", ticker="NVDA", units=30, price=70)

        response = _put(
            client, nvda, split["id"], kind="split", date="2024-01-08", ticker="NVDA", split_ratio=1.2
        )

        assert response.status_code == 422
        assert _summary(client, nvda)["holdings"][0]["units"] == pytest.approx(10.0)

    def test_removing_a_split_a_later_sell_needs_is_rejected(
        self, client: TestClient, nvda: int
    ) -> None:
        split = _split(client, nvda, 2)
        _record(client, nvda, kind="sell", date="2024-01-09", ticker="NVDA", units=30, price=70)

        response = client.delete(f"/api/portfolios/{nvda}/transactions/{split['id']}")

        assert response.status_code == 422

    def test_turning_a_buy_into_a_split_clears_its_units_and_price(
        self, client: TestClient, nvda: int
    ) -> None:
        listed = client.get(f"/api/portfolios/{nvda}/transactions").json()["transactions"]
        second_buy = listed[1]

        response = _put(
            client, nvda, second_buy["id"], kind="split", date="2024-01-03", ticker="NVDA", split_ratio=2
        )

        assert response.status_code == 200, response.text
        edited = response.json()["transaction"]
        assert edited["units"] is None and edited["price"] is None
        # Only the first Lot remains, doubled: 20 units at cost 1000.
        summary = _summary(client, nvda)
        assert summary["holdings"][0]["units"] == pytest.approx(20.0)
        assert summary["invested"] == pytest.approx(1000.0)
