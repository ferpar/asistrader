"""Tests for the once-per-ticker history repair run by the login sync.

Tickers stored before adjusted closes, instrument metadata and split events
were recorded have NULL adjusted closes (no Momentum Score), no Asset Class
and no splits for their Portfolios. The repair fills all three from Yahoo
(mocked here) and marks the ticker, so it happens once.
"""

from datetime import date, datetime
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
from sqlalchemy.orm import Session

from asistrader.models.db import MarketData, Ticker, TickerSplit
from asistrader.services import market_data_service

OLD_DAYS = [date(2024, 6, 6), date(2024, 6, 7)]


def _seed_legacy_ticker(db: Session, symbol: str) -> None:
    """A ticker as stored before migration 025: raw closes only, no metadata."""
    db.add(Ticker(symbol=symbol, currency="USD", price_hint=2))
    db.add_all(
        MarketData(ticker=symbol, date=d, open=1.0, high=1.0, low=1.0, close=1.0, volume=0)
        for d in OLD_DAYS
    )
    db.commit()


def _restated_frame(days: list[date]) -> pd.DataFrame:
    """Yahoo's answer today: closes in the current basis, with adjusted closes."""
    return pd.DataFrame(
        {
            "Open": [12.0] * len(days),
            "High": [12.0] * len(days),
            "Low": [12.0] * len(days),
            "Close": [12.0] * len(days),
            "Adj Close": [11.5] * len(days),
            "Volume": [0] * len(days),
        },
        index=pd.DatetimeIndex(days),
    )


def _yahoo_info(info: dict) -> MagicMock:
    ticker = MagicMock()
    ticker.info = info
    return MagicMock(return_value=ticker)


@pytest.fixture
def yahoo():
    """Yahoo answering for any symbol: restated bars, US stock metadata and a
    10-for-1 split on 2024-06-10."""
    with (
        patch(
            "asistrader.services.market_data_service.fetch_from_yfinance",
            side_effect=lambda symbol, start, end: _restated_frame(OLD_DAYS),
        ) as bars,
        patch(
            "asistrader.services.ticker_service.yf.Ticker",
            _yahoo_info({"quoteType": "EQUITY", "market": "us_market"}),
        ) as info,
        patch(
            "asistrader.services.market_data_service.fetch_splits_from_yfinance",
            side_effect=lambda symbol: pd.Series([10.0], index=pd.DatetimeIndex([date(2024, 6, 10)])),
        ) as splits,
    ):
        yield {"bars": bars, "info": info, "splits": splits}


class TestRepairTickerHistory:
    def test_fills_adjusted_closes_metadata_and_splits_of_a_legacy_ticker(
        self, db_session: Session, yahoo: dict
    ) -> None:
        _seed_legacy_ticker(db_session, "NVDA")

        result = market_data_service.repair_ticker_history(db_session, ["NVDA"])

        assert result == {"repaired": ["NVDA"], "errors": {}}
        rows = db_session.query(MarketData).filter(MarketData.ticker == "NVDA").all()
        assert [(r.close, r.adj_close) for r in rows] == [(12.0, 11.5), (12.0, 11.5)]
        ticker = db_session.get(Ticker, "NVDA")
        assert (ticker.instrument_type, ticker.listing_country) == ("stock", "US")
        assert ticker.history_repaired_at is not None
        split = db_session.query(TickerSplit).filter(TickerSplit.ticker == "NVDA").one()
        assert (split.date, float(split.ratio)) == (date(2024, 6, 10), 10.0)

    def test_a_repaired_ticker_is_not_fetched_again(
        self, db_session: Session, yahoo: dict
    ) -> None:
        _seed_legacy_ticker(db_session, "NVDA")
        market_data_service.repair_ticker_history(db_session, ["NVDA"])
        for mock in yahoo.values():
            mock.reset_mock()

        result = market_data_service.repair_ticker_history(db_session, ["NVDA"])

        assert result == {"repaired": [], "errors": {}}
        assert not yahoo["bars"].called
        assert not yahoo["info"].called
        assert not yahoo["splits"].called

    def test_a_failed_repair_is_retried_on_the_next_sync(
        self, db_session: Session, yahoo: dict
    ) -> None:
        _seed_legacy_ticker(db_session, "NVDA")
        yahoo["splits"].side_effect = Exception("Yahoo is down")

        result = market_data_service.repair_ticker_history(db_session, ["NVDA"])

        assert result["repaired"] == []
        assert "NVDA" in result["errors"]
        assert db_session.get(Ticker, "NVDA").history_repaired_at is None

        yahoo["splits"].side_effect = lambda symbol: pd.Series([], dtype=float)
        retried = market_data_service.repair_ticker_history(db_session, ["NVDA"])

        assert retried == {"repaired": ["NVDA"], "errors": {}}

    def test_only_the_given_tickers_are_repaired(
        self, db_session: Session, yahoo: dict
    ) -> None:
        _seed_legacy_ticker(db_session, "NVDA")
        _seed_legacy_ticker(db_session, "RR.L")

        market_data_service.repair_ticker_history(db_session, ["NVDA"])

        assert db_session.get(Ticker, "RR.L").history_repaired_at is None
        assert {call.args[0] for call in yahoo["splits"].call_args_list} == {"NVDA"}

    def test_a_complete_ticker_only_gets_its_split_events_loaded(
        self, db_session: Session, yahoo: dict
    ) -> None:
        db_session.add(
            Ticker(
                symbol="KO",
                currency="USD",
                price_hint=2,
                instrument_type="stock",
                listing_country="US",
            )
        )
        db_session.add(
            MarketData(
                ticker="KO", date=OLD_DAYS[0], open=1.0, high=1.0, low=1.0,
                close=1.0, adj_close=0.9, volume=0,
            )
        )
        db_session.commit()

        result = market_data_service.repair_ticker_history(db_session, ["KO"])

        assert result == {"repaired": ["KO"], "errors": {}}
        assert not yahoo["bars"].called
        assert not yahoo["info"].called
        assert yahoo["splits"].called
        assert isinstance(db_session.get(Ticker, "KO").history_repaired_at, datetime)
