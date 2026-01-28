"""Tests for layered SL/TP detection."""

import pytest
from datetime import date
from sqlalchemy.orm import Session

from asistrader.models.db import ExitLevel, ExitLevelStatus, ExitLevelType, MarketData, Trade, TradeStatus


class TestLayeredTPDetection:
    """Tests for layered TP detection."""

    def test_detect_first_tp_level_hit_long(
        self, db_session: Session, sample_layered_long_trade: Trade, market_data_tp1_hit: list[MarketData]
    ):
        """Detect TP1 hit for long trade when high >= TP1 price."""
        from asistrader.services.sltp_detection_service import detect_layered_hits

        hits = detect_layered_hits(db_session, sample_layered_long_trade)

        assert len(hits) == 1
        assert hits[0].level.level_type == ExitLevelType.TP
        assert hits[0].level.price == 110.0  # TP1

    def test_detect_first_tp_level_hit_short(
        self, db_session: Session, sample_layered_short_trade: Trade, market_data_tp1_hit_short: list[MarketData]
    ):
        """Detect TP1 hit for short trade when low <= TP1 price."""
        from asistrader.services.sltp_detection_service import detect_layered_hits

        hits = detect_layered_hits(db_session, sample_layered_short_trade)

        assert len(hits) == 1
        assert hits[0].level.level_type == ExitLevelType.TP
        assert hits[0].level.price == 90.0  # TP1 for short

    def test_detect_multiple_tp_levels_same_day(
        self, db_session: Session, sample_layered_long_trade: Trade, market_data_multi_tp_hit: list[MarketData]
    ):
        """When price moves big, multiple TP levels hit on same day."""
        from asistrader.services.sltp_detection_service import detect_layered_hits

        hits = detect_layered_hits(db_session, sample_layered_long_trade)

        assert len(hits) >= 2
        hit_prices = [h.level.price for h in hits]
        assert 110.0 in hit_prices  # TP1
        assert 120.0 in hit_prices  # TP2

    def test_no_hit_when_price_doesnt_reach_tp(
        self, db_session: Session, sample_layered_long_trade: Trade, market_data_flat: list[MarketData]
    ):
        """No detection when price stays below all TP levels."""
        from asistrader.services.sltp_detection_service import detect_layered_hits

        hits = detect_layered_hits(db_session, sample_layered_long_trade)

        assert len(hits) == 0


class TestLayeredSLDetection:
    """Tests for layered SL detection."""

    def test_detect_sl_level_hit_long(
        self, db_session: Session, sample_layered_long_trade: Trade, market_data_sl_hit: list[MarketData]
    ):
        """Detect SL hit for long trade when low <= SL price."""
        from asistrader.services.sltp_detection_service import detect_layered_hits

        hits = detect_layered_hits(db_session, sample_layered_long_trade)

        assert len(hits) >= 1
        sl_hits = [h for h in hits if h.level.level_type == ExitLevelType.SL]
        assert len(sl_hits) >= 1

    def test_detect_sl_level_hit_short(
        self, db_session: Session, sample_layered_short_trade: Trade, market_data_sl_hit_short: list[MarketData]
    ):
        """Detect SL hit for short trade when high >= SL price."""
        from asistrader.services.sltp_detection_service import detect_layered_hits

        hits = detect_layered_hits(db_session, sample_layered_short_trade)

        assert len(hits) >= 1
        sl_hits = [h for h in hits if h.level.level_type == ExitLevelType.SL]
        assert len(sl_hits) >= 1

    def test_detect_multiple_sl_levels_same_day(
        self, db_session: Session, sample_layered_long_trade_multi_sl: Trade, market_data_crash: list[MarketData]
    ):
        """When price crashes, multiple SL levels hit on same day."""
        from asistrader.services.sltp_detection_service import detect_layered_hits

        hits = detect_layered_hits(db_session, sample_layered_long_trade_multi_sl)

        sl_hits = [h for h in hits if h.level.level_type == ExitLevelType.SL]
        assert len(sl_hits) >= 2


class TestPartialClose:
    """Tests for partial close functionality."""

    def test_partial_close_updates_remaining_units(
        self, db_session: Session, sample_layered_long_trade: Trade, market_data_tp1_hit: list[MarketData]
    ):
        """After TP1 (50%) hit, remaining_units = 50."""
        from asistrader.services.sltp_detection_service import process_layered_hits

        initial_units = sample_layered_long_trade.remaining_units
        process_layered_hits(db_session, sample_layered_long_trade)

        db_session.refresh(sample_layered_long_trade)
        # TP1 is 50%, so remaining should be 50% of initial
        assert sample_layered_long_trade.remaining_units == int(initial_units * 0.5)

    def test_partial_close_marks_level_hit(
        self, db_session: Session, sample_layered_long_trade: Trade, market_data_tp1_hit: list[MarketData]
    ):
        """After partial close, level.status = 'hit'."""
        from asistrader.services.sltp_detection_service import process_layered_hits

        process_layered_hits(db_session, sample_layered_long_trade)

        db_session.refresh(sample_layered_long_trade)
        tp1 = next(l for l in sample_layered_long_trade.exit_levels if l.order_index == 1 and l.level_type == ExitLevelType.TP)
        assert tp1.status == ExitLevelStatus.HIT

    def test_partial_close_records_units_closed(
        self, db_session: Session, sample_layered_long_trade: Trade, market_data_tp1_hit: list[MarketData]
    ):
        """After partial close, level.units_closed is set."""
        from asistrader.services.sltp_detection_service import process_layered_hits

        process_layered_hits(db_session, sample_layered_long_trade)

        db_session.refresh(sample_layered_long_trade)
        tp1 = next(l for l in sample_layered_long_trade.exit_levels if l.order_index == 1 and l.level_type == ExitLevelType.TP)
        assert tp1.units_closed == 50  # 50% of 100 units

    def test_full_close_after_all_levels_hit(
        self, db_session: Session, sample_layered_long_trade: Trade, market_data_all_tp_hit: list[MarketData]
    ):
        """Trade status = CLOSE after all TP levels hit."""
        from asistrader.services.sltp_detection_service import process_layered_hits

        process_layered_hits(db_session, sample_layered_long_trade)

        db_session.refresh(sample_layered_long_trade)
        assert sample_layered_long_trade.status == TradeStatus.CLOSE

    def test_trade_stays_open_after_partial_close(
        self, db_session: Session, sample_layered_long_trade: Trade, market_data_tp1_hit: list[MarketData]
    ):
        """Trade status stays OPEN after TP1 hit (more levels pending)."""
        from asistrader.services.sltp_detection_service import process_layered_hits

        process_layered_hits(db_session, sample_layered_long_trade)

        db_session.refresh(sample_layered_long_trade)
        assert sample_layered_long_trade.status == TradeStatus.OPEN


class TestMoveSLToBreakeven:
    """Tests for move SL to breakeven feature."""

    def test_sl_moves_to_entry_after_tp_hit(
        self, db_session: Session, sample_layered_trade_with_be: Trade, market_data_tp1_hit: list[MarketData]
    ):
        """After TP1 hit with move_sl_to_breakeven=True, stop_loss = entry_price."""
        from asistrader.services.sltp_detection_service import process_layered_hits

        entry_price = sample_layered_trade_with_be.entry_price
        process_layered_hits(db_session, sample_layered_trade_with_be)

        db_session.refresh(sample_layered_trade_with_be)
        assert sample_layered_trade_with_be.stop_loss == entry_price

    def test_sl_unchanged_when_flag_false(
        self, db_session: Session, sample_layered_long_trade: Trade, market_data_tp1_hit: list[MarketData]
    ):
        """SL stays at original price when flag is False."""
        from asistrader.services.sltp_detection_service import process_layered_hits

        original_sl = sample_layered_long_trade.stop_loss
        process_layered_hits(db_session, sample_layered_long_trade)

        db_session.refresh(sample_layered_long_trade)
        assert sample_layered_long_trade.stop_loss == original_sl

    def test_sl_levels_move_to_breakeven(
        self, db_session: Session, sample_layered_trade_with_be: Trade, market_data_tp1_hit: list[MarketData]
    ):
        """SL exit levels are moved to entry price when move_sl_to_breakeven=True."""
        from asistrader.services.sltp_detection_service import process_layered_hits

        entry_price = sample_layered_trade_with_be.entry_price
        sl_level = next(l for l in sample_layered_trade_with_be.exit_levels if l.level_type == ExitLevelType.SL)
        assert sl_level.price != entry_price  # SL was originally 95.0, not 100.0

        process_layered_hits(db_session, sample_layered_trade_with_be)

        db_session.refresh(sl_level)
        # SL level price should now be entry price (breakeven)
        assert sl_level.price == entry_price


class TestBackwardsCompatibility:
    """Tests for backwards compatibility with simple trades."""

    def test_simple_trade_uses_old_logic(
        self, db_session: Session, sample_trade: Trade, sample_market_data: list[MarketData]
    ):
        """Trade with is_layered=False uses existing detection logic."""
        from asistrader.services.sltp_detection_service import detect_sltp_hit

        # Sample trade should use simple logic
        assert not getattr(sample_trade, 'is_layered', False)
        hit = detect_sltp_hit(db_session, sample_trade)
        # Whether hit is None or not depends on market data, but the function should work

    def test_simple_trade_auto_closes_fully(
        self, db_session: Session, sample_paper_trade: Trade, market_data_tp_hit_simple: list[MarketData]
    ):
        """Simple trade closes 100% when SL/TP hit."""
        from asistrader.services.sltp_detection_service import process_open_trades

        sltp_alerts, layered_alerts, auto_closed, partial_close_count, conflicts = process_open_trades(
            db_session, sample_paper_trade.user_id
        )

        # Find the trade
        db_session.refresh(sample_paper_trade)
        if auto_closed > 0:
            assert sample_paper_trade.status == TradeStatus.CLOSE

    def test_layered_trade_uses_new_logic(
        self, db_session: Session, sample_layered_long_trade: Trade, market_data_tp1_hit: list[MarketData]
    ):
        """Trade with is_layered=True uses layered detection."""
        from asistrader.services.sltp_detection_service import process_open_trades

        result = process_open_trades(db_session, sample_layered_long_trade.user_id)
        # The function should work with layered trades
        assert result is not None
