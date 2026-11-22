"""Portfolio API: Portfolios, Buy Transactions and the summary they replay into.

A Portfolio is separate from Trades (ADR 0001). Tests stay at the HTTP seam:
seed tickers, market data and FX rows directly, mock yfinance where a Buy has
to load an unknown ticker, and assert only on what the API returns.
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
from asistrader.services import fund_service

pytestmark = pytest.mark.usefixtures("signed_in")


@pytest.fixture
def other_headers(db_session: Session) -> dict[str, str]:
    """Auth headers for a second user, to check Portfolios stay private."""
    other = User(
        email="other@example.com",
        hashed_password=hash_password("otherpassword123"),
        is_active=True,
    )
    db_session.add(other)
    db_session.commit()
    return {"Authorization": f"Bearer {create_access_token(other.id, other.email)}"}


def _create_portfolio(client: TestClient, name: str, currency: str) -> int:
    response = client.post("/api/portfolios", json={"name": name, "currency": currency})
    assert response.status_code == 201, response.text
    return response.json()["portfolio"]["id"]


class TestPortfolios:
    def test_create_defaults_currency_to_base_currency(
        self, client: TestClient, db_session: Session, sample_user
    ) -> None:
        fund_service.update_base_currency(db_session, sample_user.id, "EUR")

        created = client.post("/api/portfolios", json={"name": "Broker A"})

        assert created.status_code == 201
        assert created.json()["portfolio"]["name"] == "Broker A"
        assert created.json()["portfolio"]["currency"] == "EUR"
        listed = client.get("/api/portfolios").json()
        assert [p["name"] for p in listed["portfolios"]] == ["Broker A"]
        assert listed["count"] == 1

    def test_create_with_explicit_currency(self, client: TestClient) -> None:
        created = client.post("/api/portfolios", json={"name": "US", "currency": "usd"})

        assert created.json()["portfolio"]["currency"] == "USD"

    def test_duplicate_name_is_rejected(self, client: TestClient) -> None:
        client.post("/api/portfolios", json={"name": "Broker A"})

        assert client.post("/api/portfolios", json={"name": "Broker A"}).status_code == 409

    def test_rename(self, client: TestClient) -> None:
        pid = _create_portfolio(client, "Old", "EUR")

        renamed = client.patch(f"/api/portfolios/{pid}", json={"name": "New"})

        assert renamed.status_code == 200
        assert client.get(f"/api/portfolios/{pid}").json()["name"] == "New"

    def test_currency_cannot_be_changed(self, client: TestClient) -> None:
        pid = _create_portfolio(client, "Broker A", "EUR")

        response = client.patch(
            f"/api/portfolios/{pid}", json={"name": "Broker A", "currency": "USD"}
        )

        assert response.status_code == 422
        assert client.get(f"/api/portfolios/{pid}").json()["currency"] == "EUR"

    def test_delete(self, client: TestClient) -> None:
        pid = _create_portfolio(client, "Broker A", "EUR")

        assert client.delete(f"/api/portfolios/{pid}").status_code == 204
        assert client.get(f"/api/portfolios/{pid}").status_code == 404
        assert client.get("/api/portfolios").json()["count"] == 0

    def test_portfolios_are_visible_only_to_their_owner(
        self, client: TestClient, other_headers: dict[str, str]
    ) -> None:
        pid = _create_portfolio(client, "Mine", "EUR")

        assert client.get("/api/portfolios", headers=other_headers).json()["count"] == 0
        assert client.get(f"/api/portfolios/{pid}", headers=other_headers).status_code == 404
        assert (
            client.patch(
                f"/api/portfolios/{pid}", json={"name": "Stolen"}, headers=other_headers
            ).status_code
            == 404
        )
        assert client.delete(f"/api/portfolios/{pid}", headers=other_headers).status_code == 404
        assert (
            client.get(f"/api/portfolios/{pid}/transactions", headers=other_headers).status_code
            == 404
        )
        assert (
            client.get(f"/api/portfolios/{pid}/summary", headers=other_headers).status_code
            == 404
        )
        assert client.get(f"/api/portfolios/{pid}").json()["name"] == "Mine"


def _seed_ticker(db: Session, symbol: str, currency: str, closes: dict[date, float]) -> None:
    db.add(Ticker(symbol=symbol, currency=currency, price_hint=2))
    db.add_all(
        MarketData(ticker=symbol, date=d, open=c, high=c, low=c, close=c, volume=0)
        for d, c in closes.items()
    )
    db.commit()


def _buy(client: TestClient, pid: int, **fields) -> dict:
    body = {"kind": "buy", "date": "2024-01-02", "fees": 0, **fields}
    response = client.post(f"/api/portfolios/{pid}/transactions", json=body)
    assert response.status_code == 201, response.text
    return response.json()["transaction"]


class TestBuyTransactions:
    def test_add_and_list_buys_with_fractional_units(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SPY", "USD", {date(2024, 1, 2): 470.0})
        pid = _create_portfolio(client, "US", "USD")

        _buy(client, pid, ticker="SPY", units=2.5, price=470.0, fees=1.25)

        listed = client.get(f"/api/portfolios/{pid}/transactions").json()
        assert listed["count"] == 1
        tx = listed["transactions"][0]
        assert tx["kind"] == "buy"
        assert tx["date"] == "2024-01-02"
        assert tx["ticker"] == "SPY"
        assert tx["units"] == 2.5
        assert tx["price"] == 470.0
        assert tx["fees"] == 1.25
        assert tx["fx_rate"] is None


class TestSummary:
    def test_empty_portfolio(self, client: TestClient) -> None:
        pid = _create_portfolio(client, "Empty", "EUR")

        summary = client.get(f"/api/portfolios/{pid}/summary").json()

        assert summary["currency"] == "EUR"
        assert summary["invested"] == 0
        assert summary["portfolio_value"] == 0
        assert summary["unrealized_gain"] == 0
        assert summary["unrealized_gain_pct"] is None
        assert summary["holdings"] == []

    def test_invested_value_and_gain_from_buys_in_portfolio_currency(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(
            db_session, "SPY", "USD", {date(2024, 1, 2): 400.0, date(2024, 1, 5): 420.0}
        )
        _seed_ticker(db_session, "QQQ", "USD", {date(2024, 1, 4): 99.0})
        pid = _create_portfolio(client, "US", "USD")
        # Two Lots of SPY: 1.5 @ 400 + 4 fees = 604, then 1 @ 410 + 2 = 412.
        _buy(client, pid, ticker="SPY", units=1.5, price=400.0, fees=4.0)
        _buy(client, pid, date="2024-01-03", ticker="SPY", units=1, price=410.0, fees=2.0)
        # QQQ: 10 @ 100 = 1000.
        _buy(client, pid, ticker="QQQ", units=10, price=100.0)

        summary = client.get(f"/api/portfolios/{pid}/summary").json()

        # Value: SPY 2.5 × 420 = 1050, QQQ 10 × 99 = 990.
        assert summary["invested"] == pytest.approx(2016.0)
        assert summary["portfolio_value"] == pytest.approx(2040.0)
        assert summary["unrealized_gain"] == pytest.approx(24.0)
        assert summary["unrealized_gain_pct"] == pytest.approx(24.0 / 2016.0)
        by_ticker = {h["ticker"]: h for h in summary["holdings"]}
        assert set(by_ticker) == {"SPY", "QQQ"}
        spy = by_ticker["SPY"]
        assert spy["units"] == pytest.approx(2.5)
        assert spy["cost"] == pytest.approx(1016.0)
        assert spy["value"] == pytest.approx(1050.0)
        assert spy["weight"] == pytest.approx(1050.0 / 2040.0)
        assert spy["unrealized_gain"] == pytest.approx(34.0)
        assert spy["unrealized_gain_pct"] == pytest.approx(34.0 / 1016.0)
        assert spy["last_price"] == 420.0
        assert spy["last_price_date"] == "2024-01-05"
        assert by_ticker["QQQ"]["unrealized_gain"] == pytest.approx(-10.0)
        assert by_ticker["QQQ"]["weight"] == pytest.approx(990.0 / 2040.0)

    def test_deleting_a_buy_removes_its_lot(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SPY", "USD", {date(2024, 1, 2): 400.0})
        pid = _create_portfolio(client, "US", "USD")
        _buy(client, pid, ticker="SPY", units=1, price=400.0)
        second = _buy(client, pid, ticker="SPY", units=2, price=400.0)

        assert (
            client.delete(f"/api/portfolios/{pid}/transactions/{second['id']}").status_code
            == 204
        )

        summary = client.get(f"/api/portfolios/{pid}/summary").json()
        assert summary["holdings"][0]["units"] == 1
        assert summary["invested"] == pytest.approx(400.0)
        assert client.get(f"/api/portfolios/{pid}/transactions").json()["count"] == 1

    def test_deleting_a_transaction_of_another_portfolio_is_not_found(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SPY", "USD", {date(2024, 1, 2): 400.0})
        mine = _create_portfolio(client, "A", "USD")
        other = _create_portfolio(client, "B", "USD")
        tx = _buy(client, pid=mine, ticker="SPY", units=1, price=400.0)

        response = client.delete(f"/api/portfolios/{other}/transactions/{tx['id']}")

        assert response.status_code == 404
        assert client.get(f"/api/portfolios/{mine}/transactions").json()["count"] == 1


def _fx_frame(d: date, rate: float) -> pd.DataFrame:
    return pd.DataFrame(
        {"Open": [rate], "High": [rate], "Low": [rate], "Close": [rate], "Volume": [0]},
        index=pd.DatetimeIndex([d]),
    )


class TestFx:
    """A EUR Portfolio holding a USD instrument. `rate_to_usd` is USD per EUR."""

    @pytest.fixture
    def eur_portfolio(self, client: TestClient, db_session: Session) -> int:
        _seed_ticker(
            db_session, "SPY", "USD", {date(2024, 1, 2): 100.0, date(2024, 1, 5): 110.0}
        )
        return _create_portfolio(client, "Broker EUR", "EUR")

    def test_lot_cost_uses_the_entered_fx_rate(
        self, client: TestClient, db_session: Session, eur_portfolio: int
    ) -> None:
        db_session.add_all([
            FxRate(currency="EUR", date=date(2024, 1, 2), rate_to_usd=1.25),
            FxRate(currency="EUR", date=date(2024, 1, 5), rate_to_usd=1.10),
        ])
        db_session.commit()

        _buy(client, eur_portfolio, ticker="SPY", units=10, price=100.0, fees=5.0, fx_rate=0.9)

        summary = client.get(f"/api/portfolios/{eur_portfolio}/summary").json()
        # (10 × 100 + 5) USD × 0.9 EUR/USD, ignoring the stored 1.25.
        assert summary["invested"] == pytest.approx(904.5)

    def test_lot_cost_uses_the_stored_rate_for_that_date_when_none_entered(
        self, client: TestClient, db_session: Session, eur_portfolio: int
    ) -> None:
        db_session.add_all([
            FxRate(currency="EUR", date=date(2024, 1, 2), rate_to_usd=1.25),
            FxRate(currency="EUR", date=date(2024, 1, 5), rate_to_usd=1.10),
        ])
        db_session.commit()

        _buy(client, eur_portfolio, ticker="SPY", units=10, price=100.0, fees=5.0)

        summary = client.get(f"/api/portfolios/{eur_portfolio}/summary").json()
        # 1005 USD / 1.25 USD-per-EUR on the Buy date.
        assert summary["invested"] == pytest.approx(804.0)

    def test_value_uses_latest_close_at_that_days_fx_rate(
        self, client: TestClient, db_session: Session, eur_portfolio: int
    ) -> None:
        db_session.add_all([
            FxRate(currency="EUR", date=date(2024, 1, 2), rate_to_usd=1.25),
            FxRate(currency="EUR", date=date(2024, 1, 5), rate_to_usd=1.10),
        ])
        db_session.commit()

        _buy(client, eur_portfolio, ticker="SPY", units=10, price=100.0)

        summary = client.get(f"/api/portfolios/{eur_portfolio}/summary").json()
        # 10 × 110 USD / 1.10 on the latest close's date = 1000 EUR; cost 800 EUR.
        assert summary["portfolio_value"] == pytest.approx(1000.0)
        assert summary["unrealized_gain"] == pytest.approx(200.0)
        assert summary["unrealized_gain_pct"] == pytest.approx(0.25)
        assert summary["holdings"][0]["value"] == pytest.approx(1000.0)

    @patch("asistrader.services.fx_service.fetch_from_yfinance")
    def test_buy_without_any_fx_rate_is_rejected(
        self, mock_fx_fetch: MagicMock, client: TestClient, eur_portfolio: int
    ) -> None:
        mock_fx_fetch.return_value = pd.DataFrame()

        response = client.post(
            f"/api/portfolios/{eur_portfolio}/transactions",
            json={"kind": "buy", "date": "2024-01-02", "ticker": "SPY", "units": 1, "price": 100},
        )

        assert response.status_code == 422
        assert "FX rate" in response.json()["detail"]
        assert client.get(f"/api/portfolios/{eur_portfolio}/transactions").json()["count"] == 0

    @patch("asistrader.services.fx_service.fetch_from_yfinance")
    def test_missing_stored_rate_is_synced_before_costing(
        self, mock_fx_fetch: MagicMock, client: TestClient, eur_portfolio: int
    ) -> None:
        mock_fx_fetch.return_value = _fx_frame(date(2024, 1, 2), 1.25)

        _buy(client, eur_portfolio, ticker="SPY", units=10, price=100.0)

        assert [c.args[0] for c in mock_fx_fetch.call_args_list] == ["EURUSD=X"]
        summary = client.get(f"/api/portfolios/{eur_portfolio}/summary").json()
        assert summary["invested"] == pytest.approx(800.0)

    @patch("asistrader.services.fx_service.fetch_from_yfinance")
    def test_missing_valuation_rate_is_synced_on_read(
        self, mock_fx_fetch: MagicMock, client: TestClient, eur_portfolio: int
    ) -> None:
        _buy(client, eur_portfolio, ticker="SPY", units=10, price=100.0, fx_rate=0.8)
        mock_fx_fetch.return_value = _fx_frame(date(2024, 1, 5), 1.10)

        summary = client.get(f"/api/portfolios/{eur_portfolio}/summary").json()

        assert summary["invested"] == pytest.approx(800.0)
        assert summary["portfolio_value"] == pytest.approx(1000.0)


def _yf_ticker(info: dict) -> MagicMock:
    mock = MagicMock()
    mock.info = info
    return mock


class TestUnknownTicker:
    @patch("asistrader.services.market_data_service.fetch_from_yfinance")
    @patch("asistrader.services.ticker_service.yf.Ticker")
    def test_buying_an_unknown_ticker_creates_it_and_loads_its_history(
        self,
        mock_yf_ticker: MagicMock,
        mock_md_fetch: MagicMock,
        client: TestClient,
    ) -> None:
        mock_yf_ticker.return_value = _yf_ticker(
            {"quoteType": "ETF", "currency": "USD", "shortName": "Vanguard S&P 500", "priceHint": 2}
        )
        mock_md_fetch.return_value = pd.DataFrame(
            {"Open": [500.0], "High": [500.0], "Low": [500.0], "Close": [500.0],
             "Adj Close": [500.0], "Volume": [0]},
            index=pd.DatetimeIndex([date(2024, 1, 3)]),
        )
        pid = _create_portfolio(client, "US", "USD")

        tx = _buy(client, pid, ticker="voo", units=0.5, price=480.0)

        assert tx["ticker"] == "VOO"
        assert mock_md_fetch.call_args.args[0] == "VOO"
        tickers = client.get("/api/tickers").json()["tickers"]
        voo = next(t for t in tickers if t["symbol"] == "VOO")
        assert voo["currency"] == "USD"
        assert voo["name"] == "Vanguard S&P 500"
        holding = client.get(f"/api/portfolios/{pid}/summary").json()["holdings"][0]
        assert holding["last_price"] == 500.0
        assert holding["value"] == pytest.approx(250.0)

    @patch("asistrader.services.ticker_service.yf.Ticker")
    def test_buying_a_symbol_yahoo_does_not_know_is_rejected(
        self, mock_yf_ticker: MagicMock, client: TestClient
    ) -> None:
        mock_yf_ticker.return_value = _yf_ticker({})
        pid = _create_portfolio(client, "US", "USD")

        response = client.post(
            f"/api/portfolios/{pid}/transactions",
            json={"kind": "buy", "date": "2024-01-02", "ticker": "NOPE", "units": 1, "price": 1},
        )

        assert response.status_code == 400
        assert client.get(f"/api/portfolios/{pid}/transactions").json()["count"] == 0


class TestBuyValidation:
    @pytest.mark.parametrize(
        "override",
        [{"units": 0}, {"units": -1}, {"price": 0}, {"fees": -1}, {"fx_rate": 0}, {"date": "2999-01-01"}],
    )
    def test_invalid_buys_are_rejected(
        self, client: TestClient, db_session: Session, override: dict
    ) -> None:
        _seed_ticker(db_session, "SPY", "USD", {date(2024, 1, 2): 400.0})
        pid = _create_portfolio(client, "US", "USD")
        body = {"kind": "buy", "date": "2024-01-02", "ticker": "SPY", "units": 1, "price": 400, **override}

        response = client.post(f"/api/portfolios/{pid}/transactions", json=body)

        assert response.status_code == 422
        assert client.get(f"/api/portfolios/{pid}/transactions").json()["count"] == 0
