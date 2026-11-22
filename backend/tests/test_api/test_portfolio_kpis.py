"""Portfolio KPIs at the HTTP seam: Weighted Days Open, Simple TIR and XIRR.

The summary is computed as of today, so Transactions are dated relative to
today and expected values are worked out by hand from those offsets.
"""

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from asistrader.models.db import FxRate, MarketData, Ticker

pytestmark = pytest.mark.usefixtures("signed_in")


def _days_ago(n: int) -> date:
    return date.today() - timedelta(days=n)


def _seed_ticker(db: Session, symbol: str, closes: dict[date, float]) -> None:
    db.add(Ticker(symbol=symbol, currency="USD", price_hint=2))
    db.add_all(
        MarketData(ticker=symbol, date=d, open=c, high=c, low=c, close=c, volume=0)
        for d, c in closes.items()
    )
    db.commit()


def _portfolio(client: TestClient, currency: str = "USD") -> int:
    response = client.post("/api/portfolios", json={"name": "P", "currency": currency})
    assert response.status_code == 201, response.text
    return response.json()["portfolio"]["id"]


def _transact(client: TestClient, pid: int, kind: str, days_ago: int, **fields) -> None:
    body = {"kind": kind, "date": _days_ago(days_ago).isoformat(), "fees": 0, **fields}
    response = client.post(f"/api/portfolios/{pid}/transactions", json=body)
    assert response.status_code == 201, response.text


def _summary(client: TestClient, pid: int) -> dict:
    response = client.get(f"/api/portfolios/{pid}/summary")
    assert response.status_code == 200, response.text
    return response.json()


class TestWeightedDaysOpen:
    def test_is_the_cost_weighted_age_of_the_lots(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SPY", {_days_ago(1): 100.0})
        pid = _portfolio(client)
        # 1000 of cost aged 100 days, 3000 aged 40 days.
        _transact(client, pid, "buy", 100, ticker="SPY", units=10, price=100.0)
        _transact(client, pid, "buy", 40, ticker="SPY", units=25, price=120.0)

        summary = _summary(client, pid)

        # (100 × 1000 + 40 × 3000) / 4000 = 55.
        assert summary["weighted_days_open"] == pytest.approx(55.0)

    def test_after_a_partial_sell_the_remaining_lot_keeps_its_date(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SPY", {_days_ago(1): 100.0})
        pid = _portfolio(client)
        _transact(client, pid, "buy", 100, ticker="SPY", units=10, price=100.0)
        _transact(client, pid, "buy", 40, ticker="SPY", units=10, price=120.0)
        # Consumes half of the oldest Lot: 5 units costing 500 stay, aged 100.
        _transact(client, pid, "sell", 10, ticker="SPY", units=5, price=130.0)

        summary = _summary(client, pid)

        # (100 × 500 + 40 × 1200) / 1700.
        assert summary["weighted_days_open"] == pytest.approx(98000 / 1700)

    def test_is_null_without_lots(self, client: TestClient, db_session: Session) -> None:
        _seed_ticker(db_session, "SPY", {_days_ago(1): 100.0})
        pid = _portfolio(client)
        assert _summary(client, pid)["weighted_days_open"] is None

        _transact(client, pid, "buy", 30, ticker="SPY", units=10, price=100.0)
        _transact(client, pid, "sell", 10, ticker="SPY", units=10, price=110.0)

        assert _summary(client, pid)["weighted_days_open"] is None


class TestSimpleTir:
    def test_annualises_relative_unrealized_gain_over_weighted_days_open(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SPY", {_days_ago(1): 110.0})
        pid = _portfolio(client)
        _transact(client, pid, "buy", 100, ticker="SPY", units=10, price=100.0)

        summary = _summary(client, pid)

        # +10% over 100 days → 0.10 × 365 / 100.
        assert summary["simple_tir"] == pytest.approx(0.365)

    def test_is_null_when_weighted_days_open_is_zero_or_undefined(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SPY", {_days_ago(1): 110.0})
        pid = _portfolio(client)
        assert _summary(client, pid)["simple_tir"] is None

        _transact(client, pid, "buy", 0, ticker="SPY", units=10, price=100.0)

        assert _summary(client, pid)["simple_tir"] is None


class TestXirr:
    def test_buy_with_fees_against_todays_value(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SPY", {_days_ago(0): 121.2})
        pid = _portfolio(client)
        # −1010 a year ago, +1212 today: exactly +20% over 365 days.
        _transact(client, pid, "buy", 365, ticker="SPY", units=10, price=100.0, fees=10.0)

        assert _summary(client, pid)["xirr"] == pytest.approx(0.2, abs=1e-6)

    def test_sell_proceeds_net_of_fees_are_an_inflow(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SPY", {_days_ago(0): 121.0})
        pid = _portfolio(client)
        _transact(client, pid, "buy", 730, ticker="SPY", units=10, price=100.0)
        _transact(client, pid, "sell", 365, ticker="SPY", units=5, price=110.0, fees=10.0)

        # −1000 two years ago, +540 a year ago, +605 today:
        # 605·x² + 540·x − 1000 = 0 with x = 1 / (1 + r).
        x = (-540 + (540**2 + 4 * 605 * 1000) ** 0.5) / (2 * 605)
        assert _summary(client, pid)["xirr"] == pytest.approx(1 / x - 1, abs=1e-6)

    def test_flows_are_in_portfolio_currency(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SPY", {_days_ago(0): 110.0})
        db_session.add(FxRate(currency="EUR", date=_days_ago(0), rate_to_usd=1.1))
        db_session.commit()
        pid = _portfolio(client, "EUR")
        # Paid 10 × 100 USD at 0.9 → −900 EUR; worth 1100 USD = 1000 EUR today.
        _transact(
            client, pid, "buy", 365, ticker="SPY", units=10, price=100.0, fx_rate=0.9
        )

        assert _summary(client, pid)["xirr"] == pytest.approx(1000 / 900 - 1, abs=1e-6)

    def test_is_null_without_transactions(self, client: TestClient) -> None:
        pid = _portfolio(client)

        assert _summary(client, pid)["xirr"] is None
