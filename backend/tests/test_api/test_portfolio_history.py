"""Portfolio daily history: one row per business day from the first Transaction.

Tests stay at the HTTP seam: seed tickers, market data and FX rows directly,
record Transactions through the API, and assert only on the columnar history
the API returns.
"""

from datetime import date
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from asistrader.auth.jwt import create_access_token
from asistrader.auth.password import hash_password
from asistrader.models.db import FxRate, MarketData, Ticker, User

pytestmark = pytest.mark.usefixtures("signed_in")


def _seed_ticker(db: Session, symbol: str, currency: str, closes: dict[date, float]) -> None:
    db.add(Ticker(symbol=symbol, currency=currency, price_hint=2))
    db.add_all(
        MarketData(ticker=symbol, date=d, open=c, high=c, low=c, close=c, volume=0)
        for d, c in closes.items()
    )
    db.commit()


def _create_portfolio(client: TestClient, name: str, currency: str) -> int:
    response = client.post("/api/portfolios", json={"name": name, "currency": currency})
    assert response.status_code == 201, response.text
    return response.json()["portfolio"]["id"]


def _record(client: TestClient, pid: int, kind: str, **fields) -> dict:
    body = {"kind": kind, "fees": 0, **fields}
    response = client.post(f"/api/portfolios/{pid}/transactions", json=body)
    assert response.status_code == 201, response.text
    return response.json()["transaction"]


def _history(client: TestClient, pid: int, **params) -> dict:
    response = client.get(f"/api/portfolios/{pid}/history", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _row(history: dict, day: str) -> dict:
    """One day of the columnar history as a dict of its columns."""
    i = history["dates"].index(day)
    return {k: v[i] for k, v in history.items() if isinstance(v, list)}


class TestRows:
    def test_one_row_per_business_day_from_the_first_transaction(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SPY", "USD", {date(2024, 1, 5): 100.0})
        pid = _create_portfolio(client, "US", "USD")
        _record(client, pid, "buy", date="2024-01-05", ticker="SPY", units=1, price=100.0)

        history = _history(client, pid, to="2024-01-10")

        # Friday, then Monday to Wednesday: the weekend has no rows.
        assert history["dates"] == ["2024-01-05", "2024-01-08", "2024-01-09", "2024-01-10"]
        assert history["currency"] == "USD"

    def test_rows_run_to_today_by_default(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SPY", "USD", {date(2024, 1, 2): 100.0})
        pid = _create_portfolio(client, "US", "USD")
        _record(client, pid, "buy", date="2024-01-02", ticker="SPY", units=1, price=100.0)

        history = _history(client, pid)

        assert history["dates"][0] == "2024-01-02"
        today = date.today()
        last_business_day = date.fromordinal(
            today.toordinal() - max(0, today.weekday() - 4)
        )
        assert history["dates"][-1] == last_business_day.isoformat()
        assert len(history["portfolio_value"]) == len(history["dates"])

    def test_from_and_to_narrow_the_rows_without_changing_them(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SPY", "USD", {date(2024, 1, 2): 100.0})
        pid = _create_portfolio(client, "US", "USD")
        _record(client, pid, "buy", date="2024-01-02", ticker="SPY", units=1, price=100.0)
        _record(client, pid, "sell", date="2024-01-04", ticker="SPY", units=1, price=110.0)

        history = _history(client, pid, **{"from": "2024-01-05", "to": "2024-01-09"})

        assert history["dates"] == ["2024-01-05", "2024-01-08", "2024-01-09"]
        # The Sell before the range still counts.
        assert history["realized_gain"] == pytest.approx([10.0] * 3)

    def test_a_portfolio_without_transactions_has_no_rows(self, client: TestClient) -> None:
        pid = _create_portfolio(client, "Empty", "EUR")

        history = _history(client, pid)

        assert history["dates"] == []
        assert history["portfolio_value"] == []

    def test_another_users_portfolio_is_not_found(
        self, client: TestClient, db_session: Session
    ) -> None:
        pid = _create_portfolio(client, "Mine", "USD")
        other = User(
            email="other@example.com",
            hashed_password=hash_password("otherpassword123"),
            is_active=True,
        )
        db_session.add(other)
        db_session.commit()
        other_headers = {
            "Authorization": f"Bearer {create_access_token(other.id, other.email)}"
        }

        response = client.get(f"/api/portfolios/{pid}/history", headers=other_headers)

        assert response.status_code == 404


class TestValuation:
    def test_value_follows_raw_closes_and_carries_them_over_holidays(
        self, client: TestClient, db_session: Session
    ) -> None:
        # No close on 01-04 (a market holiday for this instrument).
        _seed_ticker(
            db_session,
            "SPY",
            "USD",
            {date(2024, 1, 2): 100.0, date(2024, 1, 3): 110.0, date(2024, 1, 5): 120.0},
        )
        pid = _create_portfolio(client, "US", "USD")
        _record(client, pid, "buy", date="2024-01-02", ticker="SPY", units=10, price=100.0)

        history = _history(client, pid, to="2024-01-05")

        assert history["dates"] == ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"]
        assert history["invested"] == pytest.approx([1000.0] * 4)
        assert history["portfolio_value"] == pytest.approx([1000.0, 1100.0, 1100.0, 1200.0])
        assert history["unrealized_gain"] == pytest.approx([0.0, 100.0, 100.0, 200.0])
        assert history["unrealized_gain_pct"] == pytest.approx([0.0, 0.1, 0.1, 0.2])
        assert history["realized_gain"] == pytest.approx([0.0] * 4)
        assert history["total_gain"] == pytest.approx([0.0, 100.0, 100.0, 200.0])

    def test_value_converts_at_each_days_stored_fx_rate_carried_forward(
        self, client: TestClient, db_session: Session
    ) -> None:
        """A EUR Portfolio holding a USD instrument. `rate_to_usd` is USD per EUR."""
        _seed_ticker(
            db_session,
            "SPY",
            "USD",
            {date(2024, 1, 2): 100.0, date(2024, 1, 3): 100.0, date(2024, 1, 4): 100.0},
        )
        # No stored rate on 01-03.
        db_session.add_all([
            FxRate(currency="EUR", date=date(2024, 1, 2), rate_to_usd=1.25),
            FxRate(currency="EUR", date=date(2024, 1, 4), rate_to_usd=1.0),
        ])
        db_session.commit()
        pid = _create_portfolio(client, "Broker EUR", "EUR")
        _record(
            client, pid, "buy", date="2024-01-02", ticker="SPY", units=10, price=100.0,
            fx_rate=0.8,
        )

        history = _history(client, pid, to="2024-01-04")

        assert history["currency"] == "EUR"
        assert history["invested"] == pytest.approx([800.0] * 3)
        # 1000 USD / 1.25, the 01-02 rate carried to 01-03, then / 1.0.
        assert history["portfolio_value"] == pytest.approx([800.0, 800.0, 1000.0])
        assert history["unrealized_gain"] == pytest.approx([0.0, 0.0, 200.0])

    @patch("asistrader.services.fx_service.fetch_from_yfinance")
    def test_missing_fx_rates_are_synced_on_read(
        self, mock_fx_fetch: MagicMock, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SPY", "USD", {date(2024, 1, 2): 100.0})
        pid = _create_portfolio(client, "Broker EUR", "EUR")
        _record(
            client, pid, "buy", date="2024-01-02", ticker="SPY", units=10, price=100.0,
            fx_rate=0.8,
        )
        mock_fx_fetch.return_value = pd.DataFrame(
            {"Open": [1.25], "High": [1.25], "Low": [1.25], "Close": [1.25], "Volume": [0]},
            index=pd.DatetimeIndex([date(2024, 1, 2)]),
        )

        history = _history(client, pid, to="2024-01-03")

        assert [c.args[0] for c in mock_fx_fetch.call_args_list][:1] == ["EURUSD=X"]
        assert history["portfolio_value"] == pytest.approx([800.0, 800.0])

    def test_before_its_first_close_an_instrument_is_valued_at_its_buy_price(
        self, client: TestClient, db_session: Session
    ) -> None:
        # The first stored close comes two business days after the Buy.
        _seed_ticker(db_session, "SPY", "USD", {date(2024, 1, 4): 130.0})
        pid = _create_portfolio(client, "US", "USD")
        _record(client, pid, "buy", date="2024-01-02", ticker="SPY", units=10, price=120.0)

        history = _history(client, pid, to="2024-01-04")

        assert history["portfolio_value"] == pytest.approx([1200.0, 1200.0, 1300.0])


class TestGains:
    def test_sells_shrink_invested_and_accumulate_realized_gain_from_their_day(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(
            db_session, "SPY", "USD", {date(2024, 1, 2): 100.0, date(2024, 1, 5): 150.0}
        )
        pid = _create_portfolio(client, "US", "USD")
        _record(client, pid, "buy", date="2024-01-02", ticker="SPY", units=10, price=100.0,
                fees=10.0)
        _record(client, pid, "buy", date="2024-01-03", ticker="SPY", units=10, price=120.0)
        # 15 units: the whole first Lot (cost 1010) + half the second (cost 600);
        # proceeds 15 × 140 − 7 = 2093, so Realized Gain 483.
        _record(client, pid, "sell", date="2024-01-04", ticker="SPY", units=15, price=140.0,
                fees=7.0)

        history = _history(client, pid, to="2024-01-05")

        assert history["dates"] == ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"]
        assert history["invested"] == pytest.approx([1010.0, 2210.0, 600.0, 600.0])
        assert history["portfolio_value"] == pytest.approx([1000.0, 2000.0, 500.0, 750.0])
        assert history["realized_gain"] == pytest.approx([0.0, 0.0, 483.0, 483.0])
        assert history["total_gain"] == pytest.approx([-10.0, -210.0, 383.0, 633.0])

    def test_selling_everything_keeps_realized_gain_in_later_rows(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SPY", "USD", {date(2024, 1, 2): 100.0})
        pid = _create_portfolio(client, "US", "USD")
        _record(client, pid, "buy", date="2024-01-02", ticker="SPY", units=10, price=100.0)
        _record(client, pid, "sell", date="2024-01-03", ticker="SPY", units=10, price=90.0)

        row = _row(_history(client, pid, to="2024-01-04"), "2024-01-04")

        assert row["invested"] == 0
        assert row["portfolio_value"] == 0
        assert row["unrealized_gain_pct"] is None
        assert row["realized_gain"] == pytest.approx(-100.0)
        assert row["total_gain"] == pytest.approx(-100.0)
        assert row["weighted_days_open"] is None


class TestWeightedDaysOpen:
    def test_age_of_remaining_lots_weighted_by_cost_in_calendar_days(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SPY", "USD", {date(2024, 1, 1): 100.0})
        pid = _create_portfolio(client, "US", "USD")
        # Lot A: cost 1000 on Monday 01-01. Lot B: cost 3000 on Wednesday 01-03.
        _record(client, pid, "buy", date="2024-01-01", ticker="SPY", units=10, price=100.0)
        _record(client, pid, "buy", date="2024-01-03", ticker="SPY", units=10, price=300.0)
        # The Sell consumes Lot A (FIFO), leaving only Lot B.
        _record(client, pid, "sell", date="2024-01-05", ticker="SPY", units=10, price=100.0)

        history = _history(client, pid, to="2024-01-08")

        assert history["dates"] == [
            "2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08"
        ]
        # 01-03: (2 × 1000 + 0 × 3000) / 4000; 01-04: (3 × 1000 + 1 × 3000) / 4000;
        # from 01-05 only Lot B remains: 2 days, then 5 days (over the weekend).
        assert history["weighted_days_open"] == pytest.approx([0.0, 1.0, 0.5, 1.5, 2.0, 5.0])


class TestRecomputation:
    def test_editing_a_past_transaction_is_reflected_in_the_history(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(
            db_session, "SPY", "USD", {date(2024, 1, 2): 100.0, date(2024, 1, 4): 120.0}
        )
        pid = _create_portfolio(client, "US", "USD")
        buy = _record(client, pid, "buy", date="2024-01-02", ticker="SPY", units=10,
                      price=100.0)
        assert _row(_history(client, pid, to="2024-01-04"), "2024-01-04")[
            "portfolio_value"
        ] == pytest.approx(1200.0)

        edited = client.put(
            f"/api/portfolios/{pid}/transactions/{buy['id']}",
            json={"kind": "buy", "date": "2024-01-03", "ticker": "SPY", "units": 5,
                  "price": 90.0, "fees": 0},
        )
        assert edited.status_code == 200, edited.text

        history = _history(client, pid, to="2024-01-04")
        assert history["dates"] == ["2024-01-03", "2024-01-04"]
        assert history["invested"] == pytest.approx([450.0, 450.0])
        assert history["portfolio_value"] == pytest.approx([500.0, 600.0])
