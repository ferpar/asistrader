"""Tests that auto-detect skips the state-transition day itself.

With daily candles we can't tell at what point of the day a trade was opened
or an order was placed. Counting same-day highs/lows would produce false
alerts (e.g. a long trade opened after the day's low would otherwise see the
day's low as an "SL hit"). The detection service must therefore start scanning
from the day *after* the relevant transition date.
"""

from datetime import date

import pytest
from sqlalchemy.orm import Session

from asistrader.models.db import (
    ExitLevel,
    ExitLevelStatus,
    ExitLevelType,
    MarketData,
    Strategy,
    Ticker,
    Trade,
    TradeStatus,
    User,
)
from asistrader.services.sltp_detection_service import (
    detect_entry_hit,
    detect_layered_hits,
    detect_sltp_hit,
)


# --- Fixtures ---


@pytest.fixture
def ordered_long_trade(
    db_session: Session, sample_ticker: Ticker, sample_strategy: Strategy, sample_user: User
) -> Trade:
    """A long trade in ORDERED status with date_planned set."""
    trade = Trade(
        ticker=sample_ticker.symbol,
        status=TradeStatus.ORDERED,
        amount=10000.0,
        units=100,
        entry_price=100.0,
        date_planned=date(2025, 1, 15),
        strategy_id=sample_strategy.id,
        user_id=sample_user.id,
        is_layered=False,
    )
    db_session.add(trade)
    db_session.commit()

    # SL=95, TP=115 (long: SL < entry)
    db_session.add_all([
        ExitLevel(
            trade_id=trade.id,
            level_type=ExitLevelType.SL,
            price=95.0,
            units_pct=1.0,
            order_index=1,
            status=ExitLevelStatus.PENDING,
        ),
        ExitLevel(
            trade_id=trade.id,
            level_type=ExitLevelType.TP,
            price=115.0,
            units_pct=1.0,
            order_index=1,
            status=ExitLevelStatus.PENDING,
        ),
    ])
    db_session.commit()
    db_session.refresh(trade)
    return trade


def _add_bar(
    db_session: Session,
    ticker: Ticker,
    bar_date: date,
    *,
    high: float,
    low: float,
) -> MarketData:
    bar = MarketData(
        ticker=ticker.symbol,
        date=bar_date,
        open=(high + low) / 2,
        high=high,
        low=low,
        close=(high + low) / 2,
        volume=1_000_000.0,
    )
    db_session.add(bar)
    db_session.commit()
    return bar


# --- detect_sltp_hit (simple trades) ---


class TestSimpleSLTPSameDaySkip:
    """`detect_sltp_hit` must not consider the open day itself."""

    def test_sl_on_open_day_is_ignored(
        self, db_session: Session, sample_trade: Trade, sample_ticker: Ticker
    ):
        # sample_trade: long, entry=100, SL=95, TP=115, date_actual=2025-01-16
        # Same-day low pierces SL but should be ignored.
        _add_bar(db_session, sample_ticker, sample_trade.date_actual, high=101.0, low=90.0)

        assert detect_sltp_hit(db_session, sample_trade) is None

    def test_tp_on_open_day_is_ignored(
        self, db_session: Session, sample_trade: Trade, sample_ticker: Ticker
    ):
        _add_bar(db_session, sample_ticker, sample_trade.date_actual, high=120.0, low=99.0)

        assert detect_sltp_hit(db_session, sample_trade) is None

    def test_sl_on_day_after_open_is_detected(
        self, db_session: Session, sample_trade: Trade, sample_ticker: Ticker
    ):
        # Flat on open day, then SL hit the next day.
        _add_bar(db_session, sample_ticker, sample_trade.date_actual, high=101.0, low=99.0)
        next_day = date(2025, 1, 17)
        _add_bar(db_session, sample_ticker, next_day, high=101.0, low=90.0)

        hit = detect_sltp_hit(db_session, sample_trade)
        assert hit is not None
        assert hit.hit_date == next_day

    def test_tp_on_day_after_open_is_detected(
        self, db_session: Session, sample_trade: Trade, sample_ticker: Ticker
    ):
        _add_bar(db_session, sample_ticker, sample_trade.date_actual, high=101.0, low=99.0)
        next_day = date(2025, 1, 17)
        _add_bar(db_session, sample_ticker, next_day, high=120.0, low=99.0)

        hit = detect_sltp_hit(db_session, sample_trade)
        assert hit is not None
        assert hit.hit_date == next_day


# --- detect_entry_hit (ordered trades) ---


class TestEntryHitSameDaySkip:
    """`detect_entry_hit` must not consider the order day itself."""

    def test_entry_on_order_day_is_ignored(
        self, db_session: Session, ordered_long_trade: Trade, sample_ticker: Ticker
    ):
        # Long entry=100. Same-day low touches entry but should be ignored.
        _add_bar(
            db_session,
            sample_ticker,
            ordered_long_trade.date_planned,
            high=101.0,
            low=99.0,  # <= entry
        )

        assert detect_entry_hit(db_session, ordered_long_trade) is None

    def test_entry_on_day_after_order_is_detected(
        self, db_session: Session, ordered_long_trade: Trade, sample_ticker: Ticker
    ):
        # Order day above entry, next day pierces it.
        _add_bar(
            db_session, sample_ticker, ordered_long_trade.date_planned, high=105.0, low=101.0
        )
        next_day = date(2025, 1, 16)
        _add_bar(db_session, sample_ticker, next_day, high=105.0, low=99.0)

        hit = detect_entry_hit(db_session, ordered_long_trade)
        assert hit is not None
        assert hit.hit_date == next_day


# --- detect_layered_hits ---


class TestLayeredSameDaySkip:
    """`detect_layered_hits` must not consider the open day itself."""

    def test_tp_on_open_day_is_ignored(
        self,
        db_session: Session,
        sample_layered_long_trade: Trade,
        sample_ticker: Ticker,
    ):
        # Layered long: TP1=110, TP2=120, TP3=130, SL=95, date_actual=2025-01-16
        _add_bar(
            db_session,
            sample_ticker,
            sample_layered_long_trade.date_actual,
            high=125.0,  # would hit TP1 and TP2
            low=99.0,
        )

        assert detect_layered_hits(db_session, sample_layered_long_trade) == []

    def test_sl_on_open_day_is_ignored(
        self,
        db_session: Session,
        sample_layered_long_trade: Trade,
        sample_ticker: Ticker,
    ):
        _add_bar(
            db_session,
            sample_ticker,
            sample_layered_long_trade.date_actual,
            high=101.0,
            low=90.0,  # would hit SL=95
        )

        assert detect_layered_hits(db_session, sample_layered_long_trade) == []

    def test_tp_on_day_after_open_is_detected(
        self,
        db_session: Session,
        sample_layered_long_trade: Trade,
        sample_ticker: Ticker,
    ):
        # Flat on open day; TP1 hit the next day.
        _add_bar(
            db_session,
            sample_ticker,
            sample_layered_long_trade.date_actual,
            high=101.0,
            low=99.0,
        )
        next_day = date(2025, 1, 17)
        _add_bar(db_session, sample_ticker, next_day, high=112.0, low=99.0)

        hits = detect_layered_hits(db_session, sample_layered_long_trade)
        assert len(hits) == 1
        assert hits[0].hit_date == next_day
        assert hits[0].level.price == 110.0  # TP1
