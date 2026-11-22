"""Tests for `asistrader.cli.backfill_instrument_metadata`, wired to the
in-memory session, with Yahoo mocked. Effects are observed through the API."""

from datetime import date
from unittest.mock import patch

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
