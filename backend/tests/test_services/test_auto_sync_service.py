"""Tests for the unified auto-sync service.

Hooked into /api/auth/me; bundles FX, ticker MD, and benchmark MD sync.
"""

from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
from sqlalchemy.orm import Session

from asistrader.models.db import (
    Basket,
    BasketMember,
    Benchmark,
    Bias,
    FxRate,
    Portfolio,
    PortfolioTransaction,
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


@pytest.fixture
def user_with_portfolio(db_session: Session, sample_user: User) -> User:
    """A user with no Trades and one GBP Portfolio holding a EUR instrument."""
    db_session.add(Ticker(symbol="SAP.DE", currency="EUR", price_hint=2))
    portfolio = Portfolio(user_id=sample_user.id, name="Broker", currency="GBP")
    db_session.add(portfolio)
    db_session.commit()
    db_session.add(
        PortfolioTransaction(
            portfolio_id=portfolio.id,
            kind="buy",
            date=date(2024, 6, 10),
            ticker="SAP.DE",
            units=Decimal("3"),
            price=Decimal("170"),
            fees=Decimal("0"),
        )
    )
    db_session.commit()
    return sample_user


class TestEnsureUserDataFreshForPortfolios:
    @patch("asistrader.services.market_data_service.fetch_from_yfinance")
    @patch("asistrader.services.benchmark_service.fetch_from_yfinance")
    @patch("asistrader.services.fx_service.fetch_from_yfinance")
    def test_syncs_tickers_held_in_portfolios(
        self,
        mock_fx_fetch: MagicMock,
        mock_bench_fetch: MagicMock,
        mock_md_fetch: MagicMock,
        db_session: Session,
        user_with_portfolio: User,
    ) -> None:
        mock_fx_fetch.return_value = _ohlc_frame(date(2024, 6, 10))
        mock_md_fetch.return_value = _ohlc_frame(date(2024, 6, 10))

        result = auto_sync_service.ensure_user_data_fresh(
            db_session, user_with_portfolio.id
        )

        assert result["errors"] == {}
        ticker_symbols = {call[0][0] for call in mock_md_fetch.call_args_list}
        assert ticker_symbols == {"SAP.DE"}

    @patch("asistrader.services.market_data_service.fetch_from_yfinance")
    @patch("asistrader.services.benchmark_service.fetch_from_yfinance")
    @patch("asistrader.services.fx_service.fetch_from_yfinance")
    def test_starts_from_earliest_transaction_minus_buffer(
        self,
        mock_fx_fetch: MagicMock,
        mock_bench_fetch: MagicMock,
        mock_md_fetch: MagicMock,
        db_session: Session,
        user_with_portfolio: User,
    ) -> None:
        """The Portfolio's 2024-06-10 Buy is the user's earliest data; history
        is fetched from 14 days before it (2024-05-27)."""
        db_session.add(Benchmark(symbol="^STOXX50E"))
        db_session.commit()
        mock_fx_fetch.return_value = _ohlc_frame(date(2024, 6, 10))
        mock_bench_fetch.return_value = _ohlc_frame(date(2024, 6, 10))
        mock_md_fetch.return_value = _ohlc_frame(date(2024, 6, 10))

        auto_sync_service.ensure_user_data_fresh(db_session, user_with_portfolio.id)

        expected_start = date(2024, 5, 27)
        md_starts = {call[0][1] for call in mock_md_fetch.call_args_list}
        bench_starts = {call[0][1] for call in mock_bench_fetch.call_args_list}
        assert md_starts == {expected_start}
        assert bench_starts == {expected_start}

    @patch("asistrader.services.market_data_service.fetch_from_yfinance")
    @patch("asistrader.services.benchmark_service.fetch_from_yfinance")
    @patch("asistrader.services.fx_service.fetch_from_yfinance")
    def test_fx_stage_covers_portfolio_and_instrument_currencies(
        self,
        mock_fx_fetch: MagicMock,
        mock_bench_fetch: MagicMock,
        mock_md_fetch: MagicMock,
        db_session: Session,
        user_with_portfolio: User,
    ) -> None:
        """GBP (the Portfolio's currency) and EUR (SAP.DE's currency) are both
        ensured by the FX stage itself, not only as a side effect of the
        ticker stage."""
        mock_fx_fetch.return_value = _ohlc_frame(date(2024, 6, 10))
        mock_md_fetch.side_effect = Exception("yfinance tickers are down")

        result = auto_sync_service.ensure_user_data_fresh(
            db_session, user_with_portfolio.id
        )

        assert set(result["fx"]["results"]) == {"EUR", "GBP"}
        assert result["fx"]["errors"] == {}
        fx_calls = {(call[0][0], call[0][1]) for call in mock_fx_fetch.call_args_list}
        assert ("GBPUSD=X", date(2024, 5, 27)) in fx_calls
        assert ("EURUSD=X", date(2024, 5, 27)) in fx_calls


@pytest.fixture
def baskets_of_three_owners(db_session: Session, sample_user: User) -> User:
    """A Curated Basket, a Personal Basket of the user and one of another user."""
    other = User(email="other@example.com", hashed_password="x", is_active=True)
    db_session.add_all(
        [Ticker(symbol=s, currency="USD", price_hint=2) for s in ("CUR", "MINE", "THEIRS")]
        + [other]
    )
    db_session.commit()
    db_session.add_all([
        Basket(kind="curated", name="Curated", slug="curated",
               members=[BasketMember(ticker="CUR")]),
        Basket(kind="personal", owner_user_id=sample_user.id, name="Mine",
               members=[BasketMember(ticker="MINE")]),
        Basket(kind="personal", owner_user_id=other.id, name="Theirs",
               members=[BasketMember(ticker="THEIRS")]),
    ])
    db_session.commit()
    return sample_user


class TestEnsureUserDataFreshForBaskets:
    @patch("asistrader.services.market_data_service.fetch_from_yfinance")
    @patch("asistrader.services.benchmark_service.fetch_from_yfinance")
    @patch("asistrader.services.fx_service.fetch_from_yfinance")
    def test_syncs_members_of_visible_baskets_over_the_radar_window(
        self,
        mock_fx_fetch: MagicMock,
        mock_bench_fetch: MagicMock,
        mock_md_fetch: MagicMock,
        db_session: Session,
        baskets_of_three_owners: User,
    ) -> None:
        mock_md_fetch.return_value = _ohlc_frame(date.today())

        result = auto_sync_service.ensure_user_data_fresh(
            db_session, baskets_of_three_owners.id
        )

        assert result["errors"] == {}
        calls = {(call[0][0], call[0][1]) for call in mock_md_fetch.call_args_list}
        radar_start = date.today() - timedelta(days=400)
        assert calls == {("CUR", radar_start), ("MINE", radar_start)}

    @patch("asistrader.services.market_data_service.fetch_from_yfinance")
    @patch("asistrader.services.benchmark_service.fetch_from_yfinance")
    @patch("asistrader.services.fx_service.fetch_from_yfinance")
    def test_a_basket_sync_failure_does_not_block_the_other_stages(
        self,
        mock_fx_fetch: MagicMock,
        mock_bench_fetch: MagicMock,
        mock_md_fetch: MagicMock,
        db_session: Session,
        baskets_of_three_owners: User,
    ) -> None:
        db_session.add(Benchmark(symbol="^STOXX50E"))
        db_session.commit()
        mock_md_fetch.side_effect = Exception("yfinance tickers are down")
        mock_bench_fetch.return_value = _ohlc_frame(date.today())

        result = auto_sync_service.ensure_user_data_fresh(
            db_session, baskets_of_three_owners.id
        )

        assert set(result["basket_members"]["errors"]) == {"CUR", "MINE"}
        assert mock_bench_fetch.called
