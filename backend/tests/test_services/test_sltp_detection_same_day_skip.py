"""Tests for how the detector handles the state-transition day itself.

With daily candles we can't tell at what point of the day a trade was opened
or an order was placed. Phase 5 changed the prior policy of unconditionally
skipping that bar:

  - If the bar's open is already past the level → GAP_ON_ENTRY hit (we know
    the gap happened before any intraday activity; fill at the open).
  - Otherwise, an intraday touch on the open day is recorded as
    UNVERIFIABLE — the alert fires, but the UI flags it as "we can't tell
    if this was before or after entry".
  - On the day *after* the open, hits are normal INTRADAY / GAP.
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
from asistrader.models.schemas import HitKind
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


class TestSimpleSLTPOpenDay:
    """Open-day classification: GAP_ON_ENTRY when the open is already past
    the level, otherwise UNVERIFIABLE for an intraday touch."""

    def test_sl_intraday_on_open_day_is_unverifiable(
        self, db_session: Session, sample_trade: Trade, sample_ticker: Ticker
    ):
        # sample_trade: long, SL=95, date_actual=2025-01-16.
        # _add_bar uses (high+low)/2 = 95.5 for open — above SL=95, so no
        # gap on the open day; just an intraday touch we can't time.
        _add_bar(db_session, sample_ticker, sample_trade.date_actual, high=101.0, low=90.0)

        hit = detect_sltp_hit(db_session, sample_trade)
        assert hit is not None
        assert hit.hit_kind == HitKind.UNVERIFIABLE
        assert hit.hit_date == sample_trade.date_actual

    def test_tp_intraday_on_open_day_is_unverifiable(
        self, db_session: Session, sample_trade: Trade, sample_ticker: Ticker
    ):
        # TP=115, midpoint open=109.5 — below TP, intraday only.
        _add_bar(db_session, sample_ticker, sample_trade.date_actual, high=120.0, low=99.0)

        hit = detect_sltp_hit(db_session, sample_trade)
        assert hit is not None
        assert hit.hit_kind == HitKind.UNVERIFIABLE

    def test_sl_gap_on_open_day_is_classified(
        self,
        db_session: Session,
        sample_trade: Trade,
        sample_ticker: Ticker,
    ):
        # SL=95; bar opens at 90 — already past the SL when the session
        # opened, so this is a gap-on-entry (fill at 90, not 95).
        db_session.add(MarketData(
            ticker=sample_ticker.symbol, date=sample_trade.date_actual,
            open=90.0, high=91.0, low=88.0, close=89.0, volume=1_000_000.0,
        ))
        db_session.commit()

        hit = detect_sltp_hit(db_session, sample_trade)
        assert hit is not None
        assert hit.hit_kind == HitKind.GAP_ON_ENTRY
        assert hit.hit_price == 90.0

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


class TestEntryHitOrderDay:
    """Order day handling: GAP_ON_ENTRY when open already past entry,
    UNVERIFIABLE for an intraday-only touch."""

    def test_entry_intraday_on_order_day_is_unverifiable(
        self, db_session: Session, ordered_long_trade: Trade, sample_ticker: Ticker
    ):
        # Long entry=100. Bar opens at 101 (above entry) and dips to 99
        # intraday — touches entry but the open was on the "safe" side,
        # so this is intraday on the order day = UNVERIFIABLE.
        db_session.add(MarketData(
            ticker=sample_ticker.symbol, date=ordered_long_trade.date_planned,
            open=101.0, high=102.0, low=99.0, close=100.5, volume=1_000_000.0,
        ))
        db_session.commit()

        hit = detect_entry_hit(db_session, ordered_long_trade)
        assert hit is not None
        assert hit.hit_kind == HitKind.UNVERIFIABLE

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


class TestLayeredOpenDay:
    """Layered open-day classification."""

    def test_layered_open_day_mixes_gap_and_unverifiable(
        self,
        db_session: Session,
        sample_layered_long_trade: Trade,
        sample_ticker: Ticker,
    ):
        # Layered long: TP1=110, TP2=120, TP3=130, SL=95, date_actual=2025-01-16.
        # _add_bar uses midpoint open = (125+99)/2 = 112 → above TP1 but
        # below TP2. So TP1 is a GAP_ON_ENTRY, TP2 is UNVERIFIABLE intraday.
        _add_bar(
            db_session,
            sample_ticker,
            sample_layered_long_trade.date_actual,
            high=125.0,
            low=99.0,
        )

        hits = detect_layered_hits(db_session, sample_layered_long_trade)
        kinds = {h.level.order_index: h.hit_kind for h in hits}
        assert kinds[1] == HitKind.GAP_ON_ENTRY
        assert kinds[2] == HitKind.UNVERIFIABLE

    def test_layered_sl_intraday_on_open_day_is_unverifiable(
        self,
        db_session: Session,
        sample_layered_long_trade: Trade,
        sample_ticker: Ticker,
    ):
        # midpoint open=95.5 > SL=95 → not gap; intraday low pierces SL.
        _add_bar(
            db_session,
            sample_ticker,
            sample_layered_long_trade.date_actual,
            high=101.0,
            low=90.0,
        )

        hits = detect_layered_hits(db_session, sample_layered_long_trade)
        assert len(hits) == 1
        assert hits[0].hit_kind == HitKind.UNVERIFIABLE

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
