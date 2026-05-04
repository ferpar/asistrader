"""Tests for the unified auto-sync service.

Hooked into /api/auth/me; bundles FX, ticker MD, and benchmark MD sync.
"""

from datetime import date
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
from sqlalchemy.orm import Session

from asistrader.models.db import (
    Benchmark,
    Bias,
    FxRate,
    Strategy,
    Ticker,
    Trade,
    TradeStatus,
    User,
)
from asistrader.services import auto_sync_service


def _ohlc_frame(d: date) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "Open": [1.0], "High": [1.0], "Low": [1.0],
            "Close": [1.0], "Volume": [0],
        },
        index=pd.DatetimeIndex([d]),
    )


@pytest.fixture
def user_with_eur_trade(
    db_session: Session, sample_user: User, sample_strategy: Strategy
) -> User:
    """Set up a user with one EUR trade and one benchmark in the system."""
    db_session.add_all([
        Ticker(
            symbol="MTS.MC",
            currency="EUR",
            bias=Bias.LONG,
            horizon="swing",
            strategy_id=sample_strategy.id,
        ),
        Benchmark(symbol="^STOXX50E"),
    ])
    db_session.commit()
    db_session.add(
        Trade(
            ticker="MTS.MC",
            status=TradeStatus.OPEN,
            amount=1000.0,
            units=10,
            entry_price=100.0,
            date_planned=date(2025, 1, 15),
            date_actual=date(2025, 1, 20),
            user_id=sample_user.id,
        )
    )
    db_session.commit()
    return sample_user


class TestEnsureUserDataFresh:
    @patch("asistrader.services.market_data_service.fetch_from_yfinance")
    @patch("asistrader.services.benchmark_service.fetch_from_yfinance")
    @patch("asistrader.services.fx_service.fetch_from_yfinance")
    def test_runs_all_three_stages(
        self,
        mock_fx_fetch: MagicMock,
        mock_bench_fetch: MagicMock,
        mock_md_fetch: MagicMock,
        db_session: Session,
        user_with_eur_trade: User,
    ) -> None:
        mock_fx_fetch.return_value = _ohlc_frame(date(2025, 1, 20))
        mock_bench_fetch.return_value = _ohlc_frame(date(2025, 1, 20))
        mock_md_fetch.return_value = _ohlc_frame(date(2025, 1, 20))

        result = auto_sync_service.ensure_user_data_fresh(
            db_session, user_with_eur_trade.id
        )

        assert result["fx"] is not None
        assert result["tickers"] is not None
        assert result["benchmarks"] is not None
        assert result["errors"] == {}

        # FX fetched the EUR/USD pair.
        fx_symbols = {call[0][0] for call in mock_fx_fetch.call_args_list}
        assert "EURUSD=X" in fx_symbols
        # Ticker fetched MTS.MC.
        ticker_symbols = {call[0][0] for call in mock_md_fetch.call_args_list}
        assert "MTS.MC" in ticker_symbols
        # Benchmark fetched ^STOXX50E.
        bench_symbols = {call[0][0] for call in mock_bench_fetch.call_args_list}
        assert "^STOXX50E" in bench_symbols

    @patch("asistrader.services.market_data_service.fetch_from_yfinance")
    @patch("asistrader.services.benchmark_service.fetch_from_yfinance")
    @patch("asistrader.services.fx_service.fetch_from_yfinance")
    def test_idempotent_after_first_run(
        self,
        mock_fx_fetch: MagicMock,
        mock_bench_fetch: MagicMock,
        mock_md_fetch: MagicMock,
        db_session: Session,
        user_with_eur_trade: User,
    ) -> None:
        """Second call short-circuits via gap detection — no yfinance."""
        from asistrader.models.db import (
            BenchmarkMarketData,
            MarketData,
        )
        from asistrader.services.fx_service import get_last_trading_day

        last_td = get_last_trading_day(date.today())

        # Pre-populate every series up to last_trading_day so gap detection
        # finds no work for any pair. The 14-day buffer in _user_oldest_date
        # means we need rows at or before 2025-01-01 (= 2025-01-15 − 14d).
        db_session.add_all([
            FxRate(currency="EUR", date=date(2024, 12, 30), rate_to_usd=1.10),
            FxRate(currency="EUR", date=date(2025, 1, 15), rate_to_usd=1.10),
            FxRate(currency="EUR", date=last_td, rate_to_usd=1.10),
            MarketData(
                ticker="MTS.MC", date=date(2024, 12, 30),
                open=100.0, high=101.0, low=99.0, close=100.5, volume=1000.0,
            ),
            MarketData(
                ticker="MTS.MC", date=date(2025, 1, 15),
                open=100.0, high=101.0, low=99.0, close=100.5, volume=1000.0,
            ),
            MarketData(
                ticker="MTS.MC", date=last_td,
                open=100.0, high=101.0, low=99.0, close=100.5, volume=1000.0,
            ),
            BenchmarkMarketData(
                benchmark="^STOXX50E", date=date(2024, 12, 30),
                open=4500.0, high=4510.0, low=4490.0, close=4505.0, volume=0.0,
            ),
            BenchmarkMarketData(
                benchmark="^STOXX50E", date=date(2025, 1, 15),
                open=4500.0, high=4510.0, low=4490.0, close=4505.0, volume=0.0,
            ),
            BenchmarkMarketData(
                benchmark="^STOXX50E", date=last_td,
                open=4500.0, high=4510.0, low=4490.0, close=4505.0, volume=0.0,
            ),
        ])
        db_session.commit()

        auto_sync_service.ensure_user_data_fresh(db_session, user_with_eur_trade.id)

        assert mock_fx_fetch.call_count == 0
        assert mock_md_fetch.call_count == 0
        assert mock_bench_fetch.call_count == 0

    @patch("asistrader.services.market_data_service.fetch_from_yfinance")
    @patch("asistrader.services.benchmark_service.fetch_from_yfinance")
    @patch("asistrader.services.fx_service.fetch_from_yfinance")
    def test_fx_failure_does_not_block_ticker_or_benchmark(
        self,
        mock_fx_fetch: MagicMock,
        mock_bench_fetch: MagicMock,
        mock_md_fetch: MagicMock,
        db_session: Session,
        user_with_eur_trade: User,
    ) -> None:
        mock_fx_fetch.side_effect = Exception("yfinance fx is down")
        mock_md_fetch.return_value = _ohlc_frame(date(2025, 1, 20))
        mock_bench_fetch.return_value = _ohlc_frame(date(2025, 1, 20))

        result = auto_sync_service.ensure_user_data_fresh(
            db_session, user_with_eur_trade.id
        )

        # sync_fx_all catches per-currency exceptions and reports them in
        # result["fx"]["errors"]; tickers and benchmarks still completed.
        assert result["fx"] is not None
        assert "EUR" in result["fx"]["errors"]
        assert result["tickers"] is not None
        assert result["benchmarks"] is not None

    def test_user_with_no_data_does_not_crash(
        self, db_session: Session, sample_user: User
    ) -> None:
        """User who's never had a trade — no tickers, no events — doesn't crash."""
        result = auto_sync_service.ensure_user_data_fresh(db_session, sample_user.id)
        # No tickers means tickers stage is skipped (None).
        assert result["tickers"] is None
        assert result["errors"] == {}
