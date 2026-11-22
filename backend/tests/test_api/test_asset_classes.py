"""Asset Classes at the HTTP seam: Home Market, instrument metadata detection,
the global Asset Class override, and Holdings grouped by Asset Class with
per-class subtotals in the Portfolio summary.

The summary is computed as of today, so Transactions are dated relative to
today and expected values are worked out by hand from those offsets.
"""

from datetime import date, timedelta
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from asistrader.models.db import MarketData, Ticker

pytestmark = pytest.mark.usefixtures("signed_in")


def _days_ago(n: int) -> date:
    return date.today() - timedelta(days=n)


def _seed_ticker(
    db: Session,
    symbol: str,
    close: float,
    instrument_type: str | None = "stock",
    listing_country: str | None = "US",
    currency: str = "USD",
) -> None:
    db.add(
        Ticker(
            symbol=symbol,
            currency=currency,
            price_hint=2,
            instrument_type=instrument_type,
            listing_country=listing_country,
        )
    )
    db.add(
        MarketData(
            ticker=symbol, date=_days_ago(1), open=close, high=close, low=close,
            close=close, volume=0,
        )
    )
    db.commit()


def _portfolio(client: TestClient, currency: str = "USD") -> int:
    response = client.post("/api/portfolios", json={"name": "P", "currency": currency})
    assert response.status_code == 201, response.text
    return response.json()["portfolio"]["id"]


def _buy(
    client: TestClient, pid: int, ticker: str, units: float, price: float, days_ago: int
) -> None:
    body = {
        "kind": "buy",
        "date": _days_ago(days_ago).isoformat(),
        "ticker": ticker,
        "units": units,
        "price": price,
        "fees": 0,
    }
    response = client.post(f"/api/portfolios/{pid}/transactions", json=body)
    assert response.status_code == 201, response.text


def _summary(client: TestClient, pid: int) -> dict:
    response = client.get(f"/api/portfolios/{pid}/summary")
    assert response.status_code == 200, response.text
    return response.json()


def _classes(summary: dict) -> dict[str, str]:
    return {h["ticker"]: h["asset_class"] for h in summary["holdings"]}


class TestHomeMarket:
    def test_defaults_to_spain(self, client: TestClient) -> None:
        response = client.get("/api/fund/settings")

        assert response.status_code == 200
        assert response.json()["home_market"] == "ES"

    def test_can_be_set_and_read_back(self, client: TestClient) -> None:
        response = client.patch("/api/fund/settings", json={"home_market": "us"})

        assert response.status_code == 200
        assert response.json()["home_market"] == "US"
        assert client.get("/api/fund/settings").json()["home_market"] == "US"

    def test_rejects_something_that_is_not_a_country_code(
        self, client: TestClient
    ) -> None:
        response = client.patch("/api/fund/settings", json={"home_market": "Spain"})

        assert response.status_code == 422


class TestClassification:
    def test_etf_domestic_and_international_stocks(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SAN.MC", 4.0, "stock", "ES")
        _seed_ticker(db_session, "ASML", 700.0, "stock", "US")
        _seed_ticker(db_session, "SPY", 500.0, "etf", "US")
        _seed_ticker(db_session, "IWDA.AS", 90.0, "etf", "ES")
        pid = _portfolio(client)
        for symbol in ("SAN.MC", "ASML", "SPY", "IWDA.AS"):
            _buy(client, pid, symbol, 1, 10.0, 30)

        assert _classes(_summary(client, pid)) == {
            "SAN.MC": "domestic_stock",
            "ASML": "international_stock",
            "SPY": "etf",
            "IWDA.AS": "etf",
        }

    def test_domestic_follows_the_users_home_market(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SAN.MC", 4.0, "stock", "ES")
        _seed_ticker(db_session, "ASML", 700.0, "stock", "US")
        pid = _portfolio(client)
        _buy(client, pid, "SAN.MC", 1, 4.0, 30)
        _buy(client, pid, "ASML", 1, 700.0, 30)

        client.patch("/api/fund/settings", json={"home_market": "US"})

        assert _classes(_summary(client, pid)) == {
            "SAN.MC": "international_stock",
            "ASML": "domestic_stock",
        }

    def test_missing_metadata_leaves_the_holding_unclassified(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "OLD", 10.0, instrument_type=None, listing_country="ES")
        _seed_ticker(db_session, "XYZ", 10.0, "stock", listing_country=None)
        _seed_ticker(db_session, "VWRL.L", 10.0, "etf", listing_country=None)
        pid = _portfolio(client)
        for symbol in ("OLD", "XYZ", "VWRL.L"):
            _buy(client, pid, symbol, 1, 10.0, 30)

        assert _classes(_summary(client, pid)) == {
            "OLD": "unclassified",
            "XYZ": "unclassified",
            "VWRL.L": "etf",
        }


class TestSubtotals:
    def test_holdings_are_subtotalled_per_asset_class(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SAN.MC", 5.0, "stock", "ES")
        _seed_ticker(db_session, "BBVA.MC", 9.0, "stock", "ES")
        _seed_ticker(db_session, "ASML", 700.0, "stock", "US")
        _seed_ticker(db_session, "SPY", 425.0, "etf", "US")
        pid = _portfolio(client)
        _buy(client, pid, "SAN.MC", 100, 4.0, 100)  # cost 400, value 500
        _buy(client, pid, "BBVA.MC", 50, 10.0, 20)  # cost 500, value 450
        _buy(client, pid, "ASML", 1, 600.0, 50)  # cost 600, value 700
        _buy(client, pid, "SPY", 2, 400.0, 10)  # cost 800, value 850

        summary = _summary(client, pid)

        # Portfolio Value 2500; existing totals are untouched.
        assert summary["portfolio_value"] == pytest.approx(2500.0)
        assert summary["invested"] == pytest.approx(2300.0)
        groups = summary["asset_classes"]
        assert [g["asset_class"] for g in groups] == [
            "domestic_stock",
            "international_stock",
            "etf",
        ]
        domestic, international, etf = groups
        assert domestic["count"] == 2
        assert sorted(domestic["tickers"]) == ["BBVA.MC", "SAN.MC"]
        assert domestic["invested"] == pytest.approx(900.0)
        assert domestic["portfolio_value"] == pytest.approx(950.0)
        assert domestic["unrealized_gain"] == pytest.approx(50.0)
        # (100 days × 400 + 20 days × 500) / 900.
        assert domestic["weighted_days_open"] == pytest.approx(50000 / 900)
        assert domestic["weight"] == pytest.approx(0.38)

        assert international["count"] == 1
        assert international["invested"] == pytest.approx(600.0)
        assert international["portfolio_value"] == pytest.approx(700.0)
        assert international["unrealized_gain"] == pytest.approx(100.0)
        assert international["weighted_days_open"] == pytest.approx(50.0)
        assert international["weight"] == pytest.approx(0.28)

        assert etf["count"] == 1
        assert etf["portfolio_value"] == pytest.approx(850.0)
        assert etf["weighted_days_open"] == pytest.approx(10.0)
        assert etf["weight"] == pytest.approx(0.34)

    def test_each_holding_reports_the_weighted_days_open_of_its_lots(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SPY", 100.0, "etf", "US")
        pid = _portfolio(client)
        _buy(client, pid, "SPY", 10, 100.0, 100)  # cost 1000
        _buy(client, pid, "SPY", 30, 100.0, 40)  # cost 3000

        (holding,) = _summary(client, pid)["holdings"]

        # (100 × 1000 + 40 × 3000) / 4000.
        assert holding["weighted_days_open"] == pytest.approx(55.0)

    def test_no_holdings_means_no_asset_classes(self, client: TestClient) -> None:
        pid = _portfolio(client)

        assert _summary(client, pid)["asset_classes"] == []


class TestOverride:
    def test_override_wins_over_detection_and_can_be_cleared(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "ASML", 700.0, "stock", "US")
        pid = _portfolio(client)
        _buy(client, pid, "ASML", 1, 700.0, 30)

        response = client.put(
            "/api/tickers/ASML/asset-class", json={"asset_class": "domestic_stock"}
        )
        assert response.status_code == 200, response.text
        assert response.json()["ticker"]["asset_class_override"] == "domestic_stock"
        assert _classes(_summary(client, pid)) == {"ASML": "domestic_stock"}

        response = client.delete("/api/tickers/ASML/asset-class")
        assert response.status_code == 200, response.text
        assert response.json()["ticker"]["asset_class_override"] is None
        assert _classes(_summary(client, pid)) == {"ASML": "international_stock"}

    def test_override_classifies_a_ticker_without_metadata(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "OLD", 10.0, instrument_type=None, listing_country=None)
        pid = _portfolio(client)
        _buy(client, pid, "OLD", 1, 10.0, 30)

        client.put("/api/tickers/OLD/asset-class", json={"asset_class": "etf"})

        assert _classes(_summary(client, pid)) == {"OLD": "etf"}

    def test_override_is_listed_with_the_tickers_metadata(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SPY", 500.0, "etf", "US")
        client.put(
            "/api/tickers/SPY/asset-class", json={"asset_class": "international_stock"}
        )

        (ticker,) = client.get("/api/tickers").json()["tickers"]

        assert ticker["instrument_type"] == "etf"
        assert ticker["listing_country"] == "US"
        assert ticker["asset_class_override"] == "international_stock"

    @pytest.mark.parametrize("value", ["unclassified", "bond", None])
    def test_rejects_values_that_are_not_an_asset_class(
        self, client: TestClient, db_session: Session, value: str | None
    ) -> None:
        _seed_ticker(db_session, "SPY", 500.0, "etf", "US")

        response = client.put("/api/tickers/SPY/asset-class", json={"asset_class": value})

        assert response.status_code == 422

    def test_unknown_ticker_is_404(self, client: TestClient) -> None:
        put = client.put("/api/tickers/NOPE/asset-class", json={"asset_class": "etf"})
        delete = client.delete("/api/tickers/NOPE/asset-class")

        assert put.status_code == 404
        assert delete.status_code == 404


def _yahoo_info(quote_type: str, market: str, **extra) -> MagicMock:
    """A stand-in for `yf.Ticker(symbol)` whose `.info` is what Yahoo returns.

    `country` is deliberately the company's domicile, which differs from the
    listing venue for e.g. ASML on Nasdaq, to show it is not what is used.
    """
    info = {
        "quoteType": quote_type,
        "market": market,
        "shortName": "Some name",
        "currency": "USD",
        "priceHint": 2,
        **extra,
    }
    return MagicMock(return_value=MagicMock(info=info))


class TestDetectionOnCreation:
    @pytest.mark.parametrize(
        ("quote_type", "market", "instrument_type", "listing_country"),
        [
            ("EQUITY", "es_market", "stock", "ES"),
            ("EQUITY", "us_market", "stock", "US"),
            ("ETF", "gb_market", "etf", "GB"),
            ("MUTUALFUND", "us_market", "mutualfund", "US"),
            ("EQUITY", "", "stock", None),
        ],
    )
    def test_creating_a_ticker_stores_its_instrument_type_and_listing_country(
        self,
        client: TestClient,
        quote_type: str,
        market: str,
        instrument_type: str,
        listing_country: str | None,
    ) -> None:
        with patch(
            "asistrader.services.ticker_service.yf.Ticker",
            _yahoo_info(quote_type, market, country="Netherlands"),
        ):
            response = client.post("/api/tickers", json={"symbol": "abc"})

        assert response.status_code == 201, response.text
        ticker = response.json()["ticker"]
        assert ticker["instrument_type"] == instrument_type
        assert ticker["listing_country"] == listing_country

    def test_buying_an_unknown_ticker_classifies_it(self, client: TestClient) -> None:
        pid = _portfolio(client)
        with (
            patch(
                "asistrader.services.ticker_service.yf.Ticker",
                _yahoo_info("EQUITY", "es_market", currency="USD"),
            ),
            patch(
                "asistrader.services.market_data_service.fetch_from_yfinance",
                return_value=pd.DataFrame(),
            ),
        ):
            _buy(client, pid, "NEW.MC", 1, 10.0, 30)

        assert _classes(_summary(client, pid)) == {"NEW.MC": "domestic_stock"}


def _yahoo_by_symbol(infos: dict[str, dict | Exception]) -> MagicMock:
    """`yf.Ticker` stand-in answering per symbol; an Exception value is raised."""

    def make(symbol: str) -> MagicMock:
        info = infos[symbol]
        ticker = MagicMock()
        if isinstance(info, Exception):
            type(ticker).info = property(lambda _: (_ for _ in ()).throw(info))
        else:
            ticker.info = info
        return ticker

    return MagicMock(side_effect=make)


class TestBackfill:
    def test_fills_instrument_metadata_on_existing_tickers(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SAN.MC", 4.0, instrument_type=None, listing_country=None)
        _seed_ticker(db_session, "CSPX.L", 500.0, instrument_type=None, listing_country=None)
        _seed_ticker(db_session, "SPY", 500.0, "etf", "US")  # already complete
        yahoo = _yahoo_by_symbol(
            {
                "SAN.MC": {"quoteType": "EQUITY", "market": "es_market"},
                "CSPX.L": {"quoteType": "ETF", "market": "gb_market"},
            }
        )

        with patch("asistrader.services.ticker_service.yf.Ticker", yahoo):
            response = client.post("/api/tickers/backfill-instrument-metadata", json={})

        assert response.status_code == 200, response.text
        assert response.json() == {
            "results": {
                "CSPX.L": {"instrument_type": "etf", "listing_country": "GB"},
                "SAN.MC": {"instrument_type": "stock", "listing_country": "ES"},
            },
            "errors": {},
        }
        tickers = {t["symbol"]: t for t in client.get("/api/tickers").json()["tickers"]}
        assert tickers["SAN.MC"]["listing_country"] == "ES"
        assert tickers["CSPX.L"]["instrument_type"] == "etf"
        assert tickers["SPY"]["listing_country"] == "US"

    def test_backfilled_tickers_are_classified_in_the_summary(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SAN.MC", 4.0, instrument_type=None, listing_country=None)
        pid = _portfolio(client)
        _buy(client, pid, "SAN.MC", 1, 4.0, 30)
        assert _classes(_summary(client, pid)) == {"SAN.MC": "unclassified"}

        yahoo = _yahoo_by_symbol({"SAN.MC": {"quoteType": "EQUITY", "market": "es_market"}})
        with patch("asistrader.services.ticker_service.yf.Ticker", yahoo):
            client.post("/api/tickers/backfill-instrument-metadata", json={})

        assert _classes(_summary(client, pid)) == {"SAN.MC": "domestic_stock"}

    def test_can_be_limited_to_symbols_and_reports_errors_per_symbol(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_ticker(db_session, "SAN.MC", 4.0, instrument_type=None, listing_country=None)
        _seed_ticker(db_session, "BAD", 1.0, instrument_type=None, listing_country=None)
        _seed_ticker(db_session, "SKIP", 1.0, instrument_type=None, listing_country=None)
        yahoo = _yahoo_by_symbol(
            {
                "SAN.MC": {"quoteType": "EQUITY", "market": "es_market"},
                "BAD": RuntimeError("Yahoo is down"),
            }
        )

        with patch("asistrader.services.ticker_service.yf.Ticker", yahoo):
            response = client.post(
                "/api/tickers/backfill-instrument-metadata",
                json={"symbols": ["SAN.MC", "BAD"]},
            )

        body = response.json()
        assert set(body["results"]) == {"SAN.MC"}
        assert set(body["errors"]) == {"BAD"}
