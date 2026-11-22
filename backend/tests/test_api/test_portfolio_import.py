"""CSV import of Transactions into a Portfolio.

The CSV is sent as text in a JSON body. Each data row is imported on its own:
valid rows are recorded as Buys or Sells through the same validation as a
manual Transaction (so an oversell fails its row); failing rows are reported
with a reason and leave nothing behind.
Tests stay at the HTTP seam and seed tickers, market data and FX directly.
"""

from datetime import date
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from asistrader.auth.jwt import create_access_token
from asistrader.auth.password import hash_password
from asistrader.models.db import MarketData, Ticker, User

pytestmark = pytest.mark.usefixtures("signed_in")


def _create_portfolio(client: TestClient, currency: str = "USD") -> int:
    response = client.post("/api/portfolios", json={"name": "Broker", "currency": currency})
    assert response.status_code == 201, response.text
    return response.json()["portfolio"]["id"]


def _seed_ticker(db: Session, symbol: str, currency: str, closes: dict[date, float]) -> None:
    db.add(Ticker(symbol=symbol, currency=currency, price_hint=2))
    db.add_all(
        MarketData(ticker=symbol, date=d, open=c, high=c, low=c, close=c, volume=0)
        for d, c in closes.items()
    )
    db.commit()


def _import(client: TestClient, pid: int, csv: str):
    return client.post(f"/api/portfolios/{pid}/transactions/import", json={"csv": csv})


def _transactions(client: TestClient, pid: int) -> list[dict]:
    return client.get(f"/api/portfolios/{pid}/transactions").json()["transactions"]


@pytest.fixture
def spy_and_qqq(db_session: Session) -> None:
    _seed_ticker(db_session, "SPY", "USD", {date(2024, 1, 2): 400.0, date(2024, 1, 5): 420.0})
    _seed_ticker(db_session, "QQQ", "USD", {date(2024, 1, 4): 99.0})


class TestImportSuccess:
    def test_valid_rows_are_recorded_as_buys(
        self, client: TestClient, spy_and_qqq: None
    ) -> None:
        pid = _create_portfolio(client)
        csv = (
            "date,ticker,units,price,fees,fx_rate\n"
            "2024-01-02,SPY,1.5,400,4,\n"
            "2024-01-03,qqq,10,100,0,\n"
        )

        response = _import(client, pid, csv)

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["created"] == 2
        assert body["failed"] == 0
        assert [(r["row"], r["status"], r["error"]) for r in body["results"]] == [
            (2, "created", None),
            (3, "created", None),
        ]
        assert body["results"][1]["transaction"]["ticker"] == "QQQ"
        listed = _transactions(client, pid)
        assert [(t["kind"], t["date"], t["ticker"], t["units"], t["price"], t["fees"])
                for t in listed] == [
            ("buy", "2024-01-02", "SPY", 1.5, 400.0, 4.0),
            ("buy", "2024-01-03", "QQQ", 10.0, 100.0, 0.0),
        ]
        summary = client.get(f"/api/portfolios/{pid}/summary").json()
        assert summary["invested"] == pytest.approx(604.0 + 1000.0)

    def test_a_spanish_locale_spreadsheet_export_is_understood(
        self, client: TestClient, spy_and_qqq: None
    ) -> None:
        pid = _create_portfolio(client)
        csv = (
            "Date;Ticker;Units;Price;Fees;FX_Rate\r\n"
            "02/01/2024;SPY;1,5;400,25;4;\r\n"
        )

        body = _import(client, pid, csv).json()

        assert body["created"] == 1, body
        tx = _transactions(client, pid)[0]
        assert (tx["date"], tx["units"], tx["price"], tx["fees"]) == (
            "2024-01-02", 1.5, 400.25, 4.0
        )

    def test_a_kind_column_may_mark_rows_as_sells(
        self, client: TestClient, spy_and_qqq: None
    ) -> None:
        pid = _create_portfolio(client)
        csv = (
            "date,kind,ticker,units,price,fees\n"
            "2024-01-02,Buy,SPY,2,400,0\n"
            "2024-01-05,sell,spy,1,420,1\n"
            "2024-01-03,,QQQ,10,100,0\n"
        )

        body = _import(client, pid, csv).json()

        assert body["created"] == 3, body
        assert body["results"][1]["transaction"]["kind"] == "sell"
        assert [(t["kind"], t["ticker"], t["units"]) for t in _transactions(client, pid)] == [
            ("buy", "SPY", 2.0),
            ("buy", "QQQ", 10.0),
            ("sell", "SPY", 1.0),
        ]
        summary = client.get(f"/api/portfolios/{pid}/summary").json()
        # FIFO: the Sell consumes 1 of the Lot bought at 400; 420 - 400 - 1 fee.
        assert summary["realized_gain"] == pytest.approx(19.0)

    def test_an_unsupported_kind_fails_its_row(
        self, client: TestClient, spy_and_qqq: None
    ) -> None:
        pid = _create_portfolio(client)
        csv = (
            "date,kind,ticker,units,price,fees\n"
            "2024-01-02,buy,SPY,1,400,0\n"
            "2024-01-03,split,SPY,1,410,0\n"
        )

        body = _import(client, pid, csv).json()

        assert body["created"] == 1
        assert "split" in _errors(body)[3].lower()
        assert [t["kind"] for t in _transactions(client, pid)] == ["buy"]


def _errors(body: dict) -> dict[int, str]:
    return {r["row"]: r["error"] for r in body["results"] if r["status"] == "error"}


class TestRowErrors:
    def test_a_failing_row_is_reported_and_the_valid_rows_are_still_recorded(
        self, client: TestClient, spy_and_qqq: None
    ) -> None:
        pid = _create_portfolio(client)
        csv = (
            "date,ticker,units,price,fees\n"
            "2024-13-45,SPY,1,400,0\n"
            "2024-01-02,SPY,abc,400,0\n"
            "2024-01-03,QQQ,10,100,0\n"
        )

        body = _import(client, pid, csv).json()

        assert body["created"] == 1
        assert body["failed"] == 2
        errors = _errors(body)
        assert set(errors) == {2, 3}
        assert "date" in errors[2].lower()
        assert "units" in errors[3].lower()
        assert [t["ticker"] for t in _transactions(client, pid)] == ["QQQ"]

    def test_an_oversell_row_fails_and_the_other_rows_are_still_recorded(
        self, client: TestClient, spy_and_qqq: None
    ) -> None:
        pid = _create_portfolio(client)
        csv = (
            "date,kind,ticker,units,price,fees\n"
            "2024-01-02,buy,SPY,1,400,0\n"
            "2024-01-05,sell,SPY,2,420,0\n"
            "2024-01-05,sell,QQQ,1,99,0\n"
            "2024-01-05,sell,SPY,1,420,0\n"
        )

        body = _import(client, pid, csv).json()

        assert body["created"] == 2
        assert body["failed"] == 2
        errors = _errors(body)
        assert set(errors) == {3, 4}
        assert "exceeds" in errors[3] and "held" in errors[3]
        assert "QQQ" in errors[4] and "held" in errors[4]
        assert [(t["kind"], t["units"]) for t in _transactions(client, pid)] == [
            ("buy", 1.0),
            ("sell", 1.0),
        ]

    @pytest.mark.parametrize(
        ("row", "mentions"),
        [
            ("2024-01-02,SPY,0,400,0,", "units"),
            ("2024-01-02,SPY,-1,400,0,", "units"),
            ("2024-01-02,SPY,1,0,0,", "price"),
            ("2024-01-02,SPY,1,400,-1,", "fees"),
            ("2024-01-02,SPY,1,400,0,0", "fx_rate"),
            ("2999-01-01,SPY,1,400,0,", "future"),
            (",SPY,1,400,0,", "date"),
            ("2024-01-02,,1,400,0,", "ticker"),
        ],
    )
    def test_rows_breaking_the_manual_transaction_rules_are_rejected(
        self, client: TestClient, spy_and_qqq: None, row: str, mentions: str
    ) -> None:
        pid = _create_portfolio(client)

        body = _import(client, pid, f"date,ticker,units,price,fees,fx_rate\n{row}\n").json()

        assert body["created"] == 0
        assert mentions in _errors(body)[2].lower()
        assert _transactions(client, pid) == []

    @patch("asistrader.services.ticker_service.yf.Ticker")
    def test_a_symbol_yahoo_does_not_know_fails_its_row(
        self, mock_yf_ticker: MagicMock, client: TestClient, spy_and_qqq: None
    ) -> None:
        mock_yf_ticker.return_value = MagicMock(info={})
        pid = _create_portfolio(client)
        csv = "date,ticker,units,price,fees\n2024-01-02,NOPE,1,1,0\n2024-01-02,SPY,1,400,0\n"

        body = _import(client, pid, csv).json()

        assert body["created"] == 1
        assert "NOPE" in _errors(body)[2]
        assert [t["ticker"] for t in _transactions(client, pid)] == ["SPY"]

    @patch("asistrader.services.fx_service.fetch_from_yfinance")
    def test_a_row_without_any_fx_rate_fails_its_row(
        self, mock_fx_fetch: MagicMock, client: TestClient, spy_and_qqq: None
    ) -> None:
        mock_fx_fetch.return_value = pd.DataFrame()
        pid = _create_portfolio(client, currency="EUR")
        csv = (
            "date,ticker,units,price,fees,fx_rate\n"
            "2024-01-02,SPY,1,400,0,\n"
            "2024-01-02,SPY,1,400,0,0.9\n"
        )

        body = _import(client, pid, csv).json()

        assert body["created"] == 1
        assert "FX rate" in _errors(body)[2]
        listed = _transactions(client, pid)
        assert [t["fx_rate"] for t in listed] == [0.9]


class TestFileErrors:
    def test_missing_required_columns_reject_the_whole_file(
        self, client: TestClient, spy_and_qqq: None
    ) -> None:
        pid = _create_portfolio(client)

        response = _import(client, pid, "date,ticker,units\n2024-01-02,SPY,1\n")

        assert response.status_code == 422
        assert "price" in response.json()["detail"]
        assert _transactions(client, pid) == []

    @pytest.mark.parametrize("csv", ["", "date,ticker,units,price,fees\n"])
    def test_a_file_without_rows_is_rejected(self, client: TestClient, csv: str) -> None:
        pid = _create_portfolio(client)

        assert _import(client, pid, csv).status_code == 422

    def test_importing_into_another_users_portfolio_is_not_found(
        self, client: TestClient, db_session: Session, spy_and_qqq: None
    ) -> None:
        other = User(
            email="other@example.com",
            hashed_password=hash_password("otherpassword123"),
            is_active=True,
        )
        db_session.add(other)
        db_session.commit()
        headers = {"Authorization": f"Bearer {create_access_token(other.id, other.email)}"}
        pid = _create_portfolio(client)

        response = client.post(
            f"/api/portfolios/{pid}/transactions/import",
            json={"csv": "date,ticker,units,price,fees\n2024-01-02,SPY,1,400,0\n"},
            headers=headers,
        )

        assert response.status_code == 404
        assert _transactions(client, pid) == []
