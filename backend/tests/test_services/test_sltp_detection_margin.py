"""Tests for the configurable confirmation buffer in trade auto-detection.

A candle must penetrate an SL/TP/entry level by `margin` before the hit is
confirmed. This suppresses grazes within the noise band between data sources
(Yahoo vs. TradingView), biased toward fewer false positives.
"""

from datetime import date

from sqlalchemy.orm import Session

from asistrader.models.db import (
    ExitLevel,
    ExitLevelType,
    MarketData,
    Ticker,
    Trade,
)
from asistrader.services.sltp_detection_service import (
    DETECTION_MARGIN_PCT,
    check_entry_hit_for_day,
    check_layered_level_hit,
    check_sltp_hit_for_day,
    detect_sltp_hit,
)


MARGIN = 0.005  # 0.5%


def _bar(high: float, low: float) -> MarketData:
    """An unpersisted OHLC bar — `check_*` functions only read high/low."""
    return MarketData(
        ticker="TEST", date=date(2025, 1, 20),
        open=(high + low) / 2, high=high, low=low,
        close=(high + low) / 2, volume=1_000_000.0,
    )


def _level(trade: Trade, level_type: ExitLevelType, order_index: int = 1) -> ExitLevel:
    return next(
        l for l in trade.exit_levels
        if l.level_type == level_type and l.order_index == order_index
    )


# --- Simple SL/TP (long): sample_trade has SL=95, TP=115, entry=100 ---


class TestSimpleSLTPMargin:
    def test_sl_graze_within_margin_is_not_a_hit(self, sample_trade: Trade) -> None:
        # SL=95; with 0.5% margin a hit needs low <= 94.525. 94.7 only grazes.
        assert check_sltp_hit_for_day(sample_trade, _bar(101.0, 94.7), MARGIN) is None

    def test_sl_exact_touch_is_not_a_hit_with_margin(self, sample_trade: Trade) -> None:
        # Touching the level exactly is no longer enough once a buffer applies.
        assert check_sltp_hit_for_day(sample_trade, _bar(101.0, 95.0), MARGIN) is None

    def test_sl_penetration_beyond_margin_is_a_hit(self, sample_trade: Trade) -> None:
        hit = check_sltp_hit_for_day(sample_trade, _bar(101.0, 94.0), MARGIN)
        assert hit is not None and hit.value == "sl"

    def test_tp_graze_within_margin_is_not_a_hit(self, sample_trade: Trade) -> None:
        # TP=115; with 0.5% margin a hit needs high >= 115.575. 115.3 only grazes.
        assert check_sltp_hit_for_day(sample_trade, _bar(115.3, 99.0), MARGIN) is None

    def test_tp_penetration_beyond_margin_is_a_hit(self, sample_trade: Trade) -> None:
        hit = check_sltp_hit_for_day(sample_trade, _bar(116.0, 99.0), MARGIN)
        assert hit is not None and hit.value == "tp"

    def test_zero_margin_restores_exact_touch_detection(self, sample_trade: Trade) -> None:
        # With margin 0, an exact touch of SL counts — backwards-compatible.
        hit = check_sltp_hit_for_day(sample_trade, _bar(101.0, 95.0), 0.0)
        assert hit is not None and hit.value == "sl"

    def test_default_margin_constant_is_used_when_omitted(self, sample_trade: Trade) -> None:
        assert DETECTION_MARGIN_PCT == 0.005
        # Grazing low (94.7) is rejected under the default margin.
        assert check_sltp_hit_for_day(sample_trade, _bar(101.0, 94.7)) is None


# --- Entry hit (long): sample_trade entry=100 ---


class TestEntryHitMargin:
    def test_entry_graze_within_margin_is_not_a_hit(self, sample_trade: Trade) -> None:
        # entry=100; with 0.5% margin a hit needs low <= 99.5. 99.7 only grazes.
        assert check_entry_hit_for_day(sample_trade, _bar(101.0, 99.7), MARGIN) is False

    def test_entry_penetration_beyond_margin_is_a_hit(self, sample_trade: Trade) -> None:
        assert check_entry_hit_for_day(sample_trade, _bar(101.0, 99.0), MARGIN) is True


# --- Layered levels (long): sample_layered_long_trade TP1=110, SL=95 ---


class TestLayeredLevelMargin:
    def test_layered_tp_graze_within_margin_is_not_a_hit(
        self, sample_layered_long_trade: Trade
    ) -> None:
        tp1 = _level(sample_layered_long_trade, ExitLevelType.TP, 1)
        # TP1=110; hit needs high >= 110.55. 110.3 only grazes.
        assert check_layered_level_hit(
            sample_layered_long_trade, tp1, _bar(110.3, 99.0), MARGIN
        ) is False

    def test_layered_tp_penetration_beyond_margin_is_a_hit(
        self, sample_layered_long_trade: Trade
    ) -> None:
        tp1 = _level(sample_layered_long_trade, ExitLevelType.TP, 1)
        assert check_layered_level_hit(
            sample_layered_long_trade, tp1, _bar(111.0, 99.0), MARGIN
        ) is True

    def test_layered_sl_graze_within_margin_is_not_a_hit(
        self, sample_layered_long_trade: Trade
    ) -> None:
        sl = _level(sample_layered_long_trade, ExitLevelType.SL, 1)
        # SL=95; hit needs low <= 94.525. 94.7 only grazes.
        assert check_layered_level_hit(
            sample_layered_long_trade, sl, _bar(101.0, 94.7), MARGIN
        ) is False


# --- Layered levels (short): sample_layered_short_trade SL=105, TP1=90 ---


class TestLayeredLevelMarginShort:
    def test_short_sl_graze_within_margin_is_not_a_hit(
        self, sample_layered_short_trade: Trade
    ) -> None:
        sl = _level(sample_layered_short_trade, ExitLevelType.SL, 1)
        # Short SL=105; hit needs high >= 105.525. 105.3 only grazes.
        assert check_layered_level_hit(
            sample_layered_short_trade, sl, _bar(105.3, 99.0), MARGIN
        ) is False

    def test_short_sl_penetration_beyond_margin_is_a_hit(
        self, sample_layered_short_trade: Trade
    ) -> None:
        sl = _level(sample_layered_short_trade, ExitLevelType.SL, 1)
        assert check_layered_level_hit(
            sample_layered_short_trade, sl, _bar(106.0, 99.0), MARGIN
        ) is True


# --- End-to-end: detect_sltp_hit threads the margin through ---


class TestDetectSLTPHitMargin:
    def test_grazing_bar_is_suppressed_by_margin(
        self, db_session: Session, sample_trade: Trade, sample_ticker: Ticker
    ) -> None:
        # A bar the day after open grazes SL=95 (low 94.7) without penetrating.
        db_session.add(
            MarketData(
                ticker=sample_ticker.symbol, date=date(2025, 1, 17),
                open=98.0, high=101.0, low=94.7, close=98.0, volume=1_000_000.0,
            )
        )
        db_session.commit()

        # With the margin the graze is ignored...
        assert detect_sltp_hit(db_session, sample_trade, MARGIN) is None
        # ...but with margin 0 the same bar is an SL hit.
        hit = detect_sltp_hit(db_session, sample_trade, 0.0)
        assert hit is not None and hit.hit_type.value == "sl"
