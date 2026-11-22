"""Tests for `asistrader.cli.backfill_instrument_metadata`, wired to the
in-memory session, with Yahoo mocked. Effects are observed through the API."""

from datetime import date
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from asistrader.cli.backfill_instrument_metadata import main
from asistrader.models.db import MarketData, Ticker

pytestmark = pytest.mark.usefixtures("signed_in")


def _seed_complete_ticker(db: Session, symbol: str, closes: dict[date, float]) -> None:
    db.add(
        Ticker(
            symbol=symbol,
            currency="USD",
            price_hint=2,
            instrument_type="stock",
            listing_country="US",
        )
    )
    db.add_all(
        MarketData(ticker=symbol, date=d, open=c, high=c, low=c, close=c, volume=0)
        for d, c in closes.items()
    )
    db.commit()


def _seed_bare_ticker(db: Session, symbol: str) -> None:
    db.add(Ticker(symbol=symbol, currency="USD", price_hint=2))
    db.commit()


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


NO_SPLITS = patch(
    "asistrader.services.market_data_service.fetch_splits_from_yfinance",
    lambda symbol: pd.Series([], dtype=float),
)


def _yahoo_splits(by_symbol: dict[str, dict[date, float]]):
    def fetch(symbol: str) -> pd.Series:
        splits = by_symbol.get(symbol, {})
        return pd.Series(list(splits.values()), index=pd.DatetimeIndex(list(splits)))

    return fetch


class TestSplitBackfill:
    def test_existing_tickers_get_their_split_events(
        self, client: TestClient, db_session: Session, capsys: pytest.CaptureFixture[str]
    ) -> None:
        _seed_complete_ticker(
            db_session, "NVDA", {date(2024, 1, 2): 60.0, date(2024, 1, 5): 60.0}
        )
        pid = client.post("/api/portfolios", json={"name": "US", "currency": "USD"}).json()[
            "portfolio"
        ]["id"]
        client.post(
            f"/api/portfolios/{pid}/transactions",
            json={"kind": "buy", "date": "2024-01-02", "ticker": "NVDA", "units": 10, "price": 120},
        )

        with patch(
            "asistrader.services.market_data_service.fetch_splits_from_yfinance",
            _yahoo_splits({"NVDA": {date(2024, 1, 4): 2.0}}),
        ):
            rc = main([], session=db_session)

        assert rc == 0
        assert "NVDA: 1 split" in capsys.readouterr().out
        summary = client.get(f"/api/portfolios/{pid}/summary").json()
        assert summary["holdings"][0]["units"] == pytest.approx(20.0)
        assert summary["portfolio_value"] == pytest.approx(1200.0)

    def test_rerunning_does_not_apply_a_split_twice(
        self, client: TestClient, db_session: Session
    ) -> None:
        _seed_complete_ticker(db_session, "NVDA", {date(2024, 1, 2): 60.0})
        pid = client.post("/api/portfolios", json={"name": "US", "currency": "USD"}).json()[
            "portfolio"
        ]["id"]
        client.post(
            f"/api/portfolios/{pid}/transactions",
            json={"kind": "buy", "date": "2024-01-02", "ticker": "NVDA", "units": 10, "price": 120},
        )
        yahoo = _yahoo_splits({"NVDA": {date(2024, 1, 4): 2.0}})

        with patch("asistrader.services.market_data_service.fetch_splits_from_yfinance", yahoo):
            main([], session=db_session)
            main([], session=db_session)

        summary = client.get(f"/api/portfolios/{pid}/summary").json()
        assert summary["holdings"][0]["units"] == pytest.approx(20.0)


class TestInstrumentMetadataBackfill:
    def test_fills_instrument_metadata_on_existing_tickers(
        self, client: TestClient, db_session: Session, capsys: pytest.CaptureFixture[str]
    ) -> None:
        _seed_bare_ticker(db_session, "SAN.MC")
        _seed_bare_ticker(db_session, "CSPX.L")
        _seed_complete_ticker(db_session, "SPY", {})
        yahoo = _yahoo_by_symbol(
            {
                "SAN.MC": {"quoteType": "EQUITY", "market": "es_market"},
                "CSPX.L": {"quoteType": "ETF", "market": "gb_market"},
            }
        )

        with patch("asistrader.services.ticker_service.yf.Ticker", yahoo), NO_SPLITS:
            rc = main([], session=db_session)

        assert rc == 0
        out = capsys.readouterr().out
        assert "SAN.MC: stock ES" in out
        assert "CSPX.L: etf GB" in out
        assert "SPY:" not in out
        tickers = {t["symbol"]: t for t in client.get("/api/tickers").json()["tickers"]}
        assert tickers["SAN.MC"]["listing_country"] == "ES"
        assert tickers["CSPX.L"]["instrument_type"] == "etf"
        assert tickers["SPY"]["listing_country"] == "US"

    def test_can_be_limited_to_symbols_and_reports_errors_per_symbol(
        self, client: TestClient, db_session: Session, capsys: pytest.CaptureFixture[str]
    ) -> None:
        for symbol in ("SAN.MC", "BAD", "SKIP"):
            _seed_bare_ticker(db_session, symbol)
        yahoo = _yahoo_by_symbol(
            {
                "SAN.MC": {"quoteType": "EQUITY", "market": "es_market"},
                "BAD": RuntimeError("Yahoo is down"),
            }
        )

        with patch("asistrader.services.ticker_service.yf.Ticker", yahoo), NO_SPLITS:
            rc = main(["SAN.MC", "BAD"], session=db_session)

        assert rc == 1
        captured = capsys.readouterr()
        assert "SAN.MC: stock ES" in captured.out
        assert "BAD: error: Yahoo is down" in captured.err
        tickers = {t["symbol"]: t for t in client.get("/api/tickers").json()["tickers"]}
        assert tickers["SKIP"]["instrument_type"] is None
