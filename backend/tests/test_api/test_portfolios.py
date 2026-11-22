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


def _sell(client: TestClient, pid: int, **fields) -> dict:
    body = {"kind": "sell", "date": "2024-01-04", "fees": 0, **fields}
    response = client.post(f"/api/portfolios/{pid}/transactions", json=body)
    assert response.status_code == 201, response.text
    return response.json()["transaction"]


@pytest.fixture
def spy_two_lots(client: TestClient, db_session: Session) -> int:
    """A USD Portfolio with two SPY Lots: 10 @ 100 (+10 fees) on 01-02, 10 @ 120 on 01-03."""
    _seed_ticker(
        db_session, "SPY", "USD", {date(2024, 1, 2): 100.0, date(2024, 1, 5): 150.0}
    )
    pid = _create_portfolio(client, "US", "USD")
    _buy(client, pid, ticker="SPY", units=10, price=100.0, fees=10.0)
    _buy(client, pid, date="2024-01-03", ticker="SPY", units=10, price=120.0)
    return pid


class TestSells:
    """Sells consume the oldest Lots first and realize their result."""

    def test_sell_consumes_oldest_lot_first_and_realizes_gain(
        self, client: TestClient, spy_two_lots: int
    ) -> None:
        # 15 units: the whole first Lot (cost 1010) + half the second (cost 600).
        sold = _sell(client, spy_two_lots, ticker="SPY", units=15, price=140.0, fees=7.0)

        assert sold["kind"] == "sell"
        summary = client.get(f"/api/portfolios/{spy_two_lots}/summary").json()
        # Remaining: 5 units of the 120 Lot → Invested 600, value 5 × 150 = 750.
        assert summary["invested"] == pytest.approx(600.0)
        assert summary["portfolio_value"] == pytest.approx(750.0)
        assert summary["unrealized_gain"] == pytest.approx(150.0)
        # Proceeds 15 × 140 − 7 = 2093; consumed cost 1010 + 600 = 1610.
        assert summary["realized_gain"] == pytest.approx(483.0)
        assert summary["total_gain"] == pytest.approx(633.0)
        holding = summary["holdings"][0]
        assert holding["units"] == pytest.approx(5.0)
        assert holding["cost"] == pytest.approx(600.0)

    def test_later_sell_continues_from_the_partly_consumed_lot(
        self, client: TestClient, spy_two_lots: int
    ) -> None:
        _sell(client, spy_two_lots, ticker="SPY", units=5, price=110.0)
        # Then 10 more: the 5 left of the first Lot (cost 505) + 5 of the second (600).
        _sell(client, spy_two_lots, date="2024-01-05", ticker="SPY", units=10, price=130.0)

        summary = client.get(f"/api/portfolios/{spy_two_lots}/summary").json()
        assert summary["invested"] == pytest.approx(600.0)
        # (550 − 505) + (1300 − 1105) = 45 + 195.
        assert summary["realized_gain"] == pytest.approx(240.0)

    def test_selling_everything_keeps_realized_gain_and_drops_the_holding(
        self, client: TestClient, spy_two_lots: int
    ) -> None:
        _sell(client, spy_two_lots, ticker="SPY", units=20, price=100.0, fees=5.0)

        summary = client.get(f"/api/portfolios/{spy_two_lots}/summary").json()
        assert summary["holdings"] == []
        assert summary["invested"] == 0
        assert summary["portfolio_value"] == 0
        assert summary["unrealized_gain"] == 0
        # 2000 − 5 − (1010 + 1200).
        assert summary["realized_gain"] == pytest.approx(-215.0)
        assert summary["total_gain"] == pytest.approx(-215.0)

    def test_buy_only_portfolio_has_no_realized_gain(
        self, client: TestClient, spy_two_lots: int
    ) -> None:
        summary = client.get(f"/api/portfolios/{spy_two_lots}/summary").json()

        assert summary["realized_gain"] == 0
        # Value 20 × 150 = 3000, cost 2210.
        assert summary["total_gain"] == pytest.approx(790.0)

    def test_overselling_is_rejected(self, client: TestClient, spy_two_lots: int) -> None:
        response = client.post(
            f"/api/portfolios/{spy_two_lots}/transactions",
            json={"kind": "sell", "date": "2024-01-04", "ticker": "SPY", "units": 20.5, "price": 100},
        )

        assert response.status_code == 422
        assert "exceeds" in response.json()["detail"]
        assert client.get(f"/api/portfolios/{spy_two_lots}/transactions").json()["count"] == 2

    def test_selling_before_the_buy_date_is_an_oversell(
        self, client: TestClient, spy_two_lots: int
    ) -> None:
        # On 01-02 only the first Lot (10 units) is held.
        response = client.post(
            f"/api/portfolios/{spy_two_lots}/transactions",
            json={"kind": "sell", "date": "2024-01-02", "ticker": "SPY", "units": 15, "price": 100},
        )

        assert response.status_code == 422

    def test_selling_a_ticker_not_held_is_rejected(
        self, client: TestClient, db_session: Session, spy_two_lots: int
    ) -> None:
        _seed_ticker(db_session, "QQQ", "USD", {date(2024, 1, 2): 100.0})

        for symbol in ("QQQ", "UNKNOWN"):
            response = client.post(
                f"/api/portfolios/{spy_two_lots}/transactions",
                json={"kind": "sell", "date": "2024-01-04", "ticker": symbol, "units": 1, "price": 100},
            )
            assert response.status_code == 422, symbol
        assert client.get(f"/api/portfolios/{spy_two_lots}/transactions").json()["count"] == 2


class TestSellFx:
    """A EUR Portfolio selling a USD instrument: proceeds convert into EUR."""

    @pytest.fixture
    def eur_portfolio(self, client: TestClient, db_session: Session) -> int:
        _seed_ticker(db_session, "SPY", "USD", {date(2024, 1, 2): 100.0})
        db_session.add_all([
            FxRate(currency="EUR", date=date(2024, 1, 2), rate_to_usd=1.25),
            FxRate(currency="EUR", date=date(2024, 1, 4), rate_to_usd=1.10),
        ])
        db_session.commit()
        pid = _create_portfolio(client, "Broker EUR", "EUR")
        # Lot: 10 × 100 USD at 0.8 EUR/USD = 800 EUR.
        _buy(client, pid, ticker="SPY", units=10, price=100.0, fx_rate=0.8)
        return pid

    def test_proceeds_use_the_entered_fx_rate(
        self, client: TestClient, eur_portfolio: int
    ) -> None:
        _sell(client, eur_portfolio, ticker="SPY", units=10, price=120.0, fees=20.0, fx_rate=0.9)

        summary = client.get(f"/api/portfolios/{eur_portfolio}/summary").json()
        # (1200 − 20) USD × 0.9 = 1062 EUR − 800.
        assert summary["realized_gain"] == pytest.approx(262.0)

    def test_proceeds_use_the_stored_rate_for_the_sell_date(
        self, client: TestClient, eur_portfolio: int
    ) -> None:
        _sell(client, eur_portfolio, ticker="SPY", units=10, price=121.0, fees=0.0)

        summary = client.get(f"/api/portfolios/{eur_portfolio}/summary").json()
        # 1210 USD / 1.10 = 1100 EUR − 800.
        assert summary["realized_gain"] == pytest.approx(300.0)


def _put(client: TestClient, pid: int, tx_id: int, **fields):
    body = {"fees": 0, **fields}
    return client.put(f"/api/portfolios/{pid}/transactions/{tx_id}", json=body)


class TestEditTransactions:
    """Every edit or deletion replays the full list; an oversell anywhere rejects it."""

    def test_editing_a_buy_recomputes_the_summary(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SPY", "USD", {date(2024, 1, 2): 100.0})
        pid = _create_portfolio(client, "US", "USD")
        tx = _buy(client, pid, ticker="SPY", units=1, price=90.0)

        response = _put(
            client, pid, tx["id"], kind="buy", date="2024-01-02", ticker="SPY",
            units=2, price=95.0, fees=1.5,
        )

        assert response.status_code == 200, response.text
        edited = response.json()["transaction"]
        assert edited["id"] == tx["id"]
        assert edited["units"] == 2
        assert edited["price"] == 95.0
        assert edited["fees"] == 1.5
        summary = client.get(f"/api/portfolios/{pid}/summary").json()
        assert summary["invested"] == pytest.approx(191.5)
        assert client.get(f"/api/portfolios/{pid}/transactions").json()["count"] == 1

    def test_editing_a_sell_changes_the_realized_gain(
        self, client: TestClient, spy_two_lots: int
    ) -> None:
        sell = _sell(client, spy_two_lots, ticker="SPY", units=5, price=110.0)

        response = _put(
            client, spy_two_lots, sell["id"], kind="sell", date="2024-01-04",
            ticker="SPY", units=10, price=110.0,
        )

        assert response.status_code == 200, response.text
        summary = client.get(f"/api/portfolios/{spy_two_lots}/summary").json()
        # 1100 − 1010: the whole first Lot.
        assert summary["realized_gain"] == pytest.approx(90.0)

    def test_editing_a_sell_into_an_oversell_is_rejected(
        self, client: TestClient, spy_two_lots: int
    ) -> None:
        sell = _sell(client, spy_two_lots, ticker="SPY", units=5, price=110.0)

        response = _put(
            client, spy_two_lots, sell["id"], kind="sell", date="2024-01-04",
            ticker="SPY", units=25, price=110.0,
        )

        assert response.status_code == 422
        listed = client.get(f"/api/portfolios/{spy_two_lots}/transactions").json()
        assert next(t for t in listed["transactions"] if t["id"] == sell["id"])["units"] == 5

    def test_shrinking_an_earlier_buy_below_a_later_sell_is_rejected(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SPY", "USD", {date(2024, 1, 2): 100.0})
        pid = _create_portfolio(client, "US", "USD")
        buy = _buy(client, pid, ticker="SPY", units=10, price=100.0)
        _sell(client, pid, ticker="SPY", units=8, price=110.0)

        response = _put(
            client, pid, buy["id"], kind="buy", date="2024-01-02", ticker="SPY",
            units=5, price=100.0,
        )

        assert response.status_code == 422
        assert "exceeds" in response.json()["detail"]
        summary = client.get(f"/api/portfolios/{pid}/summary").json()
        assert summary["holdings"][0]["units"] == pytest.approx(2.0)
        assert summary["realized_gain"] == pytest.approx(80.0)

    def test_moving_a_buy_after_the_sell_that_needs_it_is_rejected(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SPY", "USD", {date(2024, 1, 2): 100.0})
        pid = _create_portfolio(client, "US", "USD")
        buy = _buy(client, pid, ticker="SPY", units=10, price=100.0)
        _sell(client, pid, ticker="SPY", units=8, price=110.0)

        response = _put(
            client, pid, buy["id"], kind="buy", date="2024-01-05", ticker="SPY",
            units=10, price=100.0,
        )

        assert response.status_code == 422
        listed = client.get(f"/api/portfolios/{pid}/transactions").json()
        assert next(t for t in listed["transactions"] if t["id"] == buy["id"])["date"] == "2024-01-02"

    def test_deleting_a_buy_a_later_sell_needs_is_rejected(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SPY", "USD", {date(2024, 1, 2): 100.0})
        pid = _create_portfolio(client, "US", "USD")
        buy = _buy(client, pid, ticker="SPY", units=10, price=100.0)
        _sell(client, pid, ticker="SPY", units=8, price=110.0)

        response = client.delete(f"/api/portfolios/{pid}/transactions/{buy['id']}")

        assert response.status_code == 422
        assert client.get(f"/api/portfolios/{pid}/transactions").json()["count"] == 2

    def test_deleting_a_sell_restores_its_lots(
        self, client: TestClient, spy_two_lots: int
    ) -> None:
        sell = _sell(client, spy_two_lots, ticker="SPY", units=15, price=140.0)

        response = client.delete(f"/api/portfolios/{spy_two_lots}/transactions/{sell['id']}")

        assert response.status_code == 204
        summary = client.get(f"/api/portfolios/{spy_two_lots}/summary").json()
        assert summary["invested"] == pytest.approx(2210.0)
        assert summary["realized_gain"] == 0

    def test_editing_into_the_future_is_rejected(
        self, client: TestClient, spy_two_lots: int
    ) -> None:
        tx_id = client.get(f"/api/portfolios/{spy_two_lots}/transactions").json()["transactions"][0]["id"]

        response = _put(
            client, spy_two_lots, tx_id, kind="buy", date="2999-01-01", ticker="SPY",
            units=10, price=100.0,
        )

        assert response.status_code == 422

    def test_editing_a_missing_or_foreign_transaction_is_not_found(
        self, client: TestClient, spy_two_lots: int, other_headers: dict[str, str]
    ) -> None:
        tx_id = client.get(f"/api/portfolios/{spy_two_lots}/transactions").json()["transactions"][0]["id"]
        body = {"kind": "buy", "date": "2024-01-02", "ticker": "SPY", "units": 1, "price": 1, "fees": 0}
        other_pid = _create_portfolio(client, "Other", "USD")

        assert client.put(f"/api/portfolios/{spy_two_lots}/transactions/99999", json=body).status_code == 404
        assert client.put(f"/api/portfolios/{other_pid}/transactions/{tx_id}", json=body).status_code == 404
        assert (
            client.put(
                f"/api/portfolios/{spy_two_lots}/transactions/{tx_id}", json=body, headers=other_headers
            ).status_code
            == 404
        )
        listed = client.get(f"/api/portfolios/{spy_two_lots}/transactions").json()
        assert next(t for t in listed["transactions"] if t["id"] == tx_id)["units"] == 10
