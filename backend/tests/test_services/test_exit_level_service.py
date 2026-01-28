"""Tests for exit level service."""

import pytest
from datetime import date
from sqlalchemy.orm import Session

from asistrader.models.db import ExitLevel, ExitLevelStatus, ExitLevelType, Trade, TradeStatus


class TestCreateExitLevels:
    """Tests for creating exit levels."""

    def test_create_single_tp_level(self, db_session: Session, sample_layered_trade: Trade):
        """Create one TP level at 100%."""
        from asistrader.services.exit_level_service import create_exit_levels

        levels_data = [
            {"level_type": "tp", "price": 110.0, "units_pct": 1.0, "move_sl_to_breakeven": False}
        ]
        levels = create_exit_levels(db_session, sample_layered_trade.id, levels_data)

        assert len(levels) == 1
        assert levels[0].level_type == ExitLevelType.TP
        assert levels[0].price == 110.0
        assert levels[0].units_pct == 1.0
        assert levels[0].order_index == 1
        assert levels[0].status == ExitLevelStatus.PENDING

    def test_create_multiple_tp_levels(self, db_session: Session, sample_layered_trade: Trade):
        """Create 3 TP levels (50%, 30%, 20%)."""
        from asistrader.services.exit_level_service import create_exit_levels

        levels_data = [
            {"level_type": "tp", "price": 110.0, "units_pct": 0.5, "move_sl_to_breakeven": True},
            {"level_type": "tp", "price": 120.0, "units_pct": 0.3, "move_sl_to_breakeven": False},
            {"level_type": "tp", "price": 130.0, "units_pct": 0.2, "move_sl_to_breakeven": False},
        ]
        levels = create_exit_levels(db_session, sample_layered_trade.id, levels_data)

        assert len(levels) == 3
        assert levels[0].order_index == 1
        assert levels[1].order_index == 2
        assert levels[2].order_index == 3
        assert sum(l.units_pct for l in levels) == 1.0

    def test_create_multiple_sl_levels(self, db_session: Session, sample_layered_trade: Trade):
        """Create 2 SL levels (60%, 40%)."""
        from asistrader.services.exit_level_service import create_exit_levels

        levels_data = [
            {"level_type": "sl", "price": 95.0, "units_pct": 0.6, "move_sl_to_breakeven": False},
            {"level_type": "sl", "price": 90.0, "units_pct": 0.4, "move_sl_to_breakeven": False},
        ]
        levels = create_exit_levels(db_session, sample_layered_trade.id, levels_data)

        assert len(levels) == 2
        assert all(l.level_type == ExitLevelType.SL for l in levels)
        assert sum(l.units_pct for l in levels) == 1.0

    def test_reject_tp_levels_not_summing_to_100(self, db_session: Session, sample_layered_trade: Trade):
        """Reject TP levels that sum to 80%."""
        from asistrader.services.exit_level_service import create_exit_levels, ExitLevelValidationError

        levels_data = [
            {"level_type": "tp", "price": 110.0, "units_pct": 0.5, "move_sl_to_breakeven": False},
            {"level_type": "tp", "price": 120.0, "units_pct": 0.3, "move_sl_to_breakeven": False},
            # Missing 20%
        ]
        with pytest.raises(ExitLevelValidationError) as exc_info:
            create_exit_levels(db_session, sample_layered_trade.id, levels_data)
        assert "must sum to 100%" in str(exc_info.value)

    def test_reject_sl_levels_not_summing_to_100(self, db_session: Session, sample_layered_trade: Trade):
        """Reject SL levels that sum to 120%."""
        from asistrader.services.exit_level_service import create_exit_levels, ExitLevelValidationError

        levels_data = [
            {"level_type": "sl", "price": 95.0, "units_pct": 0.6, "move_sl_to_breakeven": False},
            {"level_type": "sl", "price": 90.0, "units_pct": 0.6, "move_sl_to_breakeven": False},
        ]
        with pytest.raises(ExitLevelValidationError) as exc_info:
            create_exit_levels(db_session, sample_layered_trade.id, levels_data)
        assert "must sum to 100%" in str(exc_info.value)

    def test_order_index_assigned_correctly(self, db_session: Session, sample_layered_trade: Trade):
        """Verify levels get sequential order_index."""
        from asistrader.services.exit_level_service import create_exit_levels

        levels_data = [
            {"level_type": "tp", "price": 110.0, "units_pct": 0.5, "move_sl_to_breakeven": False},
            {"level_type": "tp", "price": 120.0, "units_pct": 0.3, "move_sl_to_breakeven": False},
            {"level_type": "tp", "price": 130.0, "units_pct": 0.2, "move_sl_to_breakeven": False},
        ]
        levels = create_exit_levels(db_session, sample_layered_trade.id, levels_data)

        for i, level in enumerate(levels, start=1):
            assert level.order_index == i


class TestMarkLevelHit:
    """Tests for marking levels as hit."""

    def test_mark_tp_level_hit(self, db_session: Session, sample_layered_trade_with_levels: Trade):
        """Mark a TP level as hit with units_closed."""
        from asistrader.services.exit_level_service import mark_level_hit

        levels = sample_layered_trade_with_levels.exit_levels
        tp_level = next(l for l in levels if l.level_type == ExitLevelType.TP)

        hit_date = date(2025, 1, 17)
        units_closed = 50
        mark_level_hit(db_session, tp_level.id, hit_date, units_closed)

        db_session.refresh(tp_level)
        assert tp_level.status == ExitLevelStatus.HIT
        assert tp_level.hit_date == hit_date
        assert tp_level.units_closed == units_closed

    def test_mark_sl_level_hit(self, db_session: Session, sample_layered_trade_with_levels: Trade):
        """Mark an SL level as hit."""
        from asistrader.services.exit_level_service import mark_level_hit

        levels = sample_layered_trade_with_levels.exit_levels
        sl_level = next(l for l in levels if l.level_type == ExitLevelType.SL)

        hit_date = date(2025, 1, 17)
        units_closed = 100
        mark_level_hit(db_session, sl_level.id, hit_date, units_closed)

        db_session.refresh(sl_level)
        assert sl_level.status == ExitLevelStatus.HIT
        assert sl_level.hit_date == hit_date
        assert sl_level.units_closed == units_closed

    def test_cannot_mark_already_hit_level(self, db_session: Session, sample_layered_trade_with_levels: Trade):
        """Reject marking a level that's already hit."""
        from asistrader.services.exit_level_service import mark_level_hit, ExitLevelValidationError

        levels = sample_layered_trade_with_levels.exit_levels
        tp_level = next(l for l in levels if l.level_type == ExitLevelType.TP)

        # First mark as hit
        mark_level_hit(db_session, tp_level.id, date(2025, 1, 17), 50)

        # Try to mark again
        with pytest.raises(ExitLevelValidationError) as exc_info:
            mark_level_hit(db_session, tp_level.id, date(2025, 1, 18), 50)
        assert "already hit" in str(exc_info.value).lower()


class TestCancelRemainingLevels:
    """Tests for cancelling remaining levels."""

    def test_cancel_pending_levels(self, db_session: Session, sample_layered_trade_with_levels: Trade):
        """Cancel all pending levels when trade manually closed."""
        from asistrader.services.exit_level_service import cancel_remaining_levels

        trade = sample_layered_trade_with_levels
        cancel_remaining_levels(db_session, trade.id)

        db_session.refresh(trade)
        for level in trade.exit_levels:
            assert level.status == ExitLevelStatus.CANCELLED

    def test_already_hit_levels_unchanged(self, db_session: Session, sample_layered_trade_with_levels: Trade):
        """Already hit levels keep their status."""
        from asistrader.services.exit_level_service import mark_level_hit, cancel_remaining_levels

        trade = sample_layered_trade_with_levels
        levels = trade.exit_levels
        tp_level = next(l for l in levels if l.level_type == ExitLevelType.TP)

        # Mark one level as hit
        mark_level_hit(db_session, tp_level.id, date(2025, 1, 17), 50)

        # Cancel remaining
        cancel_remaining_levels(db_session, trade.id)

        db_session.refresh(trade)
        for level in trade.exit_levels:
            if level.id == tp_level.id:
                assert level.status == ExitLevelStatus.HIT
            else:
                assert level.status == ExitLevelStatus.CANCELLED
