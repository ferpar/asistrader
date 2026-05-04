"""Tests for the FX rate service."""

from datetime import date
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
from sqlalchemy.orm import Session

from asistrader.models.db import FxRate
from asistrader.services import fx_service


class TestGetRateToUsd:
    """Lookup behavior of `get_rate_to_usd`."""

    def test_usd_returns_one(self, db_session: Session) -> None:
        assert fx_service.get_rate_to_usd(db_session, "USD", date(2026, 5, 1)) == 1.0

    def test_exact_date_match(self, db_session: Session) -> None:
        db_session.add(FxRate(currency="EUR", date=date(2026, 5, 1), rate_to_usd=1.10))
        db_session.commit()
        assert fx_service.get_rate_to_usd(db_session, "EUR", date(2026, 5, 1)) == 1.10

    def test_walks_back_for_weekend(self, db_session: Session) -> None:
        # Friday rate; query Sunday → should return Friday's rate.
        db_session.add(FxRate(currency="EUR", date=date(2026, 5, 1), rate_to_usd=1.10))
        db_session.commit()
        assert fx_service.get_rate_to_usd(db_session, "EUR", date(2026, 5, 3)) == 1.10

    def test_picks_most_recent_at_or_before(self, db_session: Session) -> None:
        db_session.add_all([
            FxRate(currency="EUR", date=date(2026, 4, 28), rate_to_usd=1.05),
            FxRate(currency="EUR", date=date(2026, 4, 30), rate_to_usd=1.10),
        ])
        db_session.commit()
        assert fx_service.get_rate_to_usd(db_session, "EUR", date(2026, 5, 1)) == 1.10

    def test_raises_when_no_rate_within_window(self, db_session: Session) -> None:
        # Rate is 30 days before the query date; far outside the 7-day window.
        db_session.add(FxRate(currency="EUR", date=date(2026, 4, 1), rate_to_usd=1.10))
        db_session.commit()
        with pytest.raises(fx_service.FxRateUnavailable):
            fx_service.get_rate_to_usd(db_session, "EUR", date(2026, 5, 1))

    def test_raises_when_no_rates_at_all(self, db_session: Session) -> None:
        with pytest.raises(fx_service.FxRateUnavailable):
            fx_service.get_rate_to_usd(db_session, "EUR", date(2026, 5, 1))


class TestConvert:
    """Pure-function conversion math."""

    def test_same_currency_passthrough(self, db_session: Session) -> None:
        # No rates needed when from == to.
        assert fx_service.convert(db_session, 100.0, "EUR", "EUR", date(2026, 5, 1)) == 100.0

    def test_to_usd(self, db_session: Session) -> None:
        db_session.add(FxRate(currency="EUR", date=date(2026, 5, 1), rate_to_usd=1.10))
        db_session.commit()
        assert fx_service.convert(
            db_session, 100.0, "EUR", "USD", date(2026, 5, 1)
        ) == pytest.approx(110.0)

    def test_from_usd(self, db_session: Session) -> None:
        db_session.add(FxRate(currency="EUR", date=date(2026, 5, 1), rate_to_usd=1.25))
        db_session.commit()
        # 100 USD ÷ 1.25 = 80 EUR
        assert fx_service.convert(
            db_session, 100.0, "USD", "EUR", date(2026, 5, 1)
        ) == pytest.approx(80.0)

    def test_triangulates_through_usd(self, db_session: Session) -> None:
        db_session.add_all([
            FxRate(currency="EUR", date=date(2026, 5, 1), rate_to_usd=1.10),
            FxRate(currency="GBP", date=date(2026, 5, 1), rate_to_usd=1.25),
        ])
        db_session.commit()
        # 100 EUR -> USD: 100 * 1.10 = 110 USD
        # 110 USD -> GBP: 110 / 1.25 = 88 GBP
        assert fx_service.convert(
            db_session, 100.0, "EUR", "GBP", date(2026, 5, 1)
        ) == pytest.approx(88.0)


class TestSyncFxPair:
    """Gap-fill behavior — mirrors `market_data_service.sync_ticker`."""

    @patch("asistrader.services.fx_service.fetch_from_yfinance")
    def test_first_sync_fetches_full_range(
        self, mock_fetch: MagicMock, db_session: Session
    ) -> None:
        mock_fetch.return_value = pd.DataFrame(
            {
                "Open": [1.10, 1.11],
                "High": [1.12, 1.13],
                "Low": [1.09, 1.10],
                "Close": [1.11, 1.12],
                "Volume": [0, 0],
            },
            index=pd.DatetimeIndex([date(2026, 4, 28), date(2026, 4, 29)]),
        )

        result = fx_service.sync_fx_pair(db_session, "EUR", date(2026, 4, 28))

        assert result["fetched"] == 2
        assert result["skipped"] is False
        rows = db_session.query(FxRate).filter(FxRate.currency == "EUR").all()
        assert {r.date for r in rows} == {date(2026, 4, 28), date(2026, 4, 29)}
        assert all(r.rate_to_usd > 0 for r in rows)

    @patch("asistrader.services.fx_service.fetch_from_yfinance")
    def test_skips_when_already_covered(
        self, mock_fetch: MagicMock, db_session: Session
    ) -> None:
        # Pre-populate with rates that already cover up to last_trading_day.
        # Use today's last_trading_day to avoid ambiguity.
        last_td = fx_service.get_last_trading_day(date.today())
        db_session.add_all([
            FxRate(currency="EUR", date=date(2026, 4, 1), rate_to_usd=1.10),
            FxRate(currency="EUR", date=last_td, rate_to_usd=1.12),
        ])
        db_session.commit()

        result = fx_service.sync_fx_pair(db_session, "EUR", date(2026, 4, 1))

        assert result["fetched"] == 0
        assert result["skipped"] is True
        mock_fetch.assert_not_called()

    def test_usd_is_noop(self, db_session: Session) -> None:
        # USD never hits yfinance (anchor currency).
        result = fx_service.sync_fx_pair(db_session, "USD", date(2026, 1, 1))
        assert result == {"fetched": 0, "skipped": True}


class TestSubunitCurrencies:
    """GBp / GBX are sub-units of GBP; no yfinance pair exists for them."""

    def test_get_rate_for_gbp_subunit_uses_parent_divided(self, db_session: Session) -> None:
        # 1 GBP = 1.25 USD → 1 GBp = 0.0125 USD
        db_session.add(FxRate(currency="GBP", date=date(2026, 5, 1), rate_to_usd=1.25))
        db_session.commit()
        rate = fx_service.get_rate_to_usd(db_session, "GBp", date(2026, 5, 1))
        assert rate == pytest.approx(0.0125)

    def test_gbx_alias_uses_same_divisor(self, db_session: Session) -> None:
        db_session.add(FxRate(currency="GBP", date=date(2026, 5, 1), rate_to_usd=1.25))
        db_session.commit()
        rate = fx_service.get_rate_to_usd(db_session, "GBX", date(2026, 5, 1))
        assert rate == pytest.approx(0.0125)

    def test_convert_gbp_pence_to_usd(self, db_session: Session) -> None:
        # RR.L at 1132.60 GBp at GBP/USD = 1.25:
        # 1132.60 GBp × 0.0125 USD/GBp = 14.1575 USD
        db_session.add(FxRate(currency="GBP", date=date(2026, 5, 1), rate_to_usd=1.25))
        db_session.commit()
        usd = fx_service.convert(
            db_session, 1132.60, "GBp", "USD", date(2026, 5, 1)
        )
        assert usd == pytest.approx(14.1575)

    def test_convert_gbp_pence_to_eur_triangulates(self, db_session: Session) -> None:
        # 1132.60 GBp → GBP 11.326 → USD 14.1575 (at 1.25) → EUR 12.8704... (at 1.10)
        db_session.add_all([
            FxRate(currency="GBP", date=date(2026, 5, 1), rate_to_usd=1.25),
            FxRate(currency="EUR", date=date(2026, 5, 1), rate_to_usd=1.10),
        ])
        db_session.commit()
        eur = fx_service.convert(
            db_session, 1132.60, "GBp", "EUR", date(2026, 5, 1)
        )
        assert eur == pytest.approx(14.1575 / 1.10)

    @patch("asistrader.services.fx_service.fetch_from_yfinance")
    def test_sync_for_gbp_subunit_fetches_canonical_pair(
        self, mock_fetch: MagicMock, db_session: Session
    ) -> None:
        """sync_fx_pair('GBp', ...) should fetch GBPUSD=X, not GBpUSD=X."""
        mock_fetch.return_value = pd.DataFrame(
            {
                "Open": [1.25], "High": [1.26], "Low": [1.24],
                "Close": [1.25], "Volume": [0],
            },
            index=pd.DatetimeIndex([date(2026, 5, 1)]),
        )

        fx_service.sync_fx_pair(db_session, "GBp", date(2026, 5, 1))

        assert mock_fetch.call_count == 1
        called_symbol = mock_fetch.call_args[0][0]
        assert called_symbol == "GBPUSD=X"

        # Stored under GBP, not GBp.
        rows = db_session.query(FxRate).all()
        assert {r.currency for r in rows} == {"GBP"}


class TestSekRegression:
    """SEK is a normal currency — covered by a yfinance pair SEKUSD=X."""

    @patch("asistrader.services.fx_service.fetch_from_yfinance")
    def test_sync_for_sek_uses_sekusd(
        self, mock_fetch: MagicMock, db_session: Session
    ) -> None:
        mock_fetch.return_value = pd.DataFrame(
            {
                "Open": [0.094], "High": [0.095], "Low": [0.093],
                "Close": [0.094], "Volume": [0],
            },
            index=pd.DatetimeIndex([date(2026, 5, 1)]),
        )

        fx_service.sync_fx_pair(db_session, "SEK", date(2026, 5, 1))

        assert mock_fetch.call_args[0][0] == "SEKUSD=X"
        rows = db_session.query(FxRate).filter(FxRate.currency == "SEK").all()
        assert len(rows) == 1
        assert rows[0].rate_to_usd == pytest.approx(0.094)


class TestEnsureRatesForUser:
    """`ensure_rates_for_user` derives currencies + oldest date from the user's data."""

    @patch("asistrader.services.fx_service.fetch_from_yfinance")
    def test_syncs_distinct_ticker_currencies_plus_base(
        self,
        mock_fetch: MagicMock,
        db_session: Session,
        sample_user,
        sample_strategy,
    ) -> None:
        from datetime import date as _date

        from asistrader.models.db import (
            Bias,
            Ticker,
            Trade,
            TradeStatus,
            UserFundSettings,
        )

        # Two trades, one EUR and one GBP.
        eur_ticker = Ticker(
            symbol="MTS.MC", currency="EUR", bias=Bias.LONG,
            horizon="swing", strategy_id=sample_strategy.id,
        )
        gbp_ticker = Ticker(
            symbol="LLOY.L", currency="GBP", bias=Bias.LONG,
            horizon="swing", strategy_id=sample_strategy.id,
        )
        db_session.add_all([eur_ticker, gbp_ticker])
        db_session.commit()

        db_session.add_all([
            Trade(
                ticker="MTS.MC", status=TradeStatus.OPEN,
                amount=1000.0, units=10, entry_price=100.0,
                date_planned=_date(2024, 6, 1),
                date_actual=_date(2024, 6, 5),
                user_id=sample_user.id,
            ),
            Trade(
                ticker="LLOY.L", status=TradeStatus.OPEN,
                amount=500.0, units=10, entry_price=50.0,
                date_planned=_date(2025, 1, 15),
                date_actual=_date(2025, 1, 20),
                user_id=sample_user.id,
            ),
        ])
        db_session.add(UserFundSettings(user_id=sample_user.id, base_currency="USD"))
        db_session.commit()

        mock_fetch.return_value = pd.DataFrame(
            {
                "Open": [1.0], "High": [1.0], "Low": [1.0],
                "Close": [1.0], "Volume": [0],
            },
            index=pd.DatetimeIndex([date(2024, 6, 1)]),
        )

        result = fx_service.ensure_rates_for_user(db_session, sample_user.id)

        # USD (base) is skipped; EUR + GBP fetched.
        assert "EUR" in result["results"]
        assert "GBP" in result["results"]
        assert "USD" in result["skipped"]
        # Earliest date = 2024-06-01 (oldest trade.date_planned).
        for call in mock_fetch.call_args_list:
            start_date_arg = call[0][1]
            assert start_date_arg == date(2024, 6, 1)

    @patch("asistrader.services.fx_service.fetch_from_yfinance")
    def test_falls_back_to_default_lookback_when_no_data(
        self, mock_fetch: MagicMock, db_session: Session, sample_user
    ) -> None:
        """User with no trades/events still triggers a sync over a sensible window."""
        from asistrader.models.db import UserFundSettings

        # User's base = EUR, no other data.
        db_session.add(UserFundSettings(user_id=sample_user.id, base_currency="EUR"))
        db_session.commit()

        mock_fetch.return_value = pd.DataFrame(
            {
                "Open": [1.10], "High": [1.10], "Low": [1.10],
                "Close": [1.10], "Volume": [0],
            },
            index=pd.DatetimeIndex([date.today()]),
        )

        result = fx_service.ensure_rates_for_user(db_session, sample_user.id)

        assert "EUR" in result["results"]
        # Should have asked yfinance for ~1 year of data.
        start_arg = mock_fetch.call_args_list[0][0][1]
        delta = (date.today() - start_arg).days
        assert 360 <= delta <= 370

    @patch("asistrader.services.fx_service.fetch_from_yfinance")
    def test_idempotent_after_first_run(
        self, mock_fetch: MagicMock, db_session: Session, sample_user, sample_strategy
    ) -> None:
        """Second call short-circuits via gap detection — no yfinance call."""
        from datetime import date as _date

        from asistrader.models.db import Bias, Ticker, Trade, TradeStatus

        ticker = Ticker(
            symbol="MTS.MC", currency="EUR", bias=Bias.LONG,
            horizon="swing", strategy_id=sample_strategy.id,
        )
        db_session.add(ticker)
        db_session.commit()
        db_session.add(
            Trade(
                ticker="MTS.MC", status=TradeStatus.OPEN,
                amount=1000.0, units=10, entry_price=100.0,
                date_planned=fx_service.get_last_trading_day(date.today()),
                date_actual=_date.today(),
                user_id=sample_user.id,
            )
        )
        db_session.commit()

        # Pre-populate rate so first call has nothing to fetch.
        last_td = fx_service.get_last_trading_day(date.today())
        db_session.add(FxRate(currency="EUR", date=last_td, rate_to_usd=1.10))
        db_session.commit()

        fx_service.ensure_rates_for_user(db_session, sample_user.id)
        assert mock_fetch.call_count == 0


class TestSyncFxAll:
    """Aggregate sync over a list of currencies."""

    @patch("asistrader.services.fx_service.fetch_from_yfinance")
    def test_runs_per_currency_skips_usd(
        self, mock_fetch: MagicMock, db_session: Session
    ) -> None:
        mock_fetch.return_value = pd.DataFrame(
            {
                "Open": [1.10],
                "High": [1.11],
                "Low": [1.09],
                "Close": [1.10],
                "Volume": [0],
            },
            index=pd.DatetimeIndex([date(2026, 4, 28)]),
        )

        result = fx_service.sync_fx_all(
            db_session, ["EUR", "USD", "GBP"], date(2026, 4, 28)
        )

        # USD is skipped without a yfinance call; EUR and GBP each fetched once.
        assert "USD" in result["skipped"]
        assert result["results"].get("EUR", 0) == 1
        assert result["results"].get("GBP", 0) == 1
        assert mock_fetch.call_count == 2
