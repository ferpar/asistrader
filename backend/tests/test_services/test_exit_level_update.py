"""Tests for exit level update functionality."""

import pytest
from datetime import date

from asistrader.models.db import ExitLevel, ExitLevelStatus, ExitLevelType, Ticker, Trade, TradeStatus
from asistrader.services.exit_level_service import replace_exit_levels, create_exit_levels
from asistrader.services.trade_service import update_trade, create_trade


@pytest.fixture
def aapl_ticker(db_session):
    """Create an AAPL ticker for tests."""
    ticker = Ticker(symbol="AAPL", name="Apple Inc.")
    db_session.add(ticker)
    db_session.commit()
    return ticker


class TestReplaceExitLevels:
    """Tests for replace_exit_levels function."""

    def test_replace_levels_on_plan_trade(self, db_session, aapl_ticker):
        """Replacing exit levels on a plan trade should work."""
        # Create a trade (all trades now have exit_levels)
        trade = create_trade(
            db_session,
            ticker="AAPL",
            entry_price=100.0,
            units=100,
            date_planned=date.today(),
            exit_levels=[
                {"level_type": "tp", "price": 110.0, "units_pct": 1.0},
                {"level_type": "sl", "price": 95.0, "units_pct": 1.0},
            ],
        )
        assert len(trade.exit_levels) == 2

        # Replace with new levels
        new_levels = [
            {"level_type": "tp", "price": 105.0, "units_pct": 0.5},
            {"level_type": "tp", "price": 115.0, "units_pct": 0.5},
            {"level_type": "sl", "price": 90.0, "units_pct": 1.0},
        ]
        created, is_layered = replace_exit_levels(db_session, trade.id, new_levels)

        assert is_layered is True
        assert len(created) == 3
        # Verify old levels are gone
        db_session.refresh(trade)
        assert len(trade.exit_levels) == 3
        tp_levels = [l for l in trade.exit_levels if l.level_type == ExitLevelType.TP]
        assert len(tp_levels) == 2

    def test_replace_with_empty_removes_layered_mode(self, db_session, aapl_ticker):
        """Replacing with empty list should set is_layered to False."""
        trade = create_trade(
            db_session,
            ticker="AAPL",
            entry_price=100.0,
            units=100,
            date_planned=date.today(),
            exit_levels=[
                {"level_type": "tp", "price": 110.0, "units_pct": 1.0},
                {"level_type": "sl", "price": 95.0, "units_pct": 1.0},
            ],
        )

        created, is_layered = replace_exit_levels(db_session, trade.id, [])

        assert is_layered is False
        assert len(created) == 0

    def test_replace_with_none_removes_layered_mode(self, db_session, aapl_ticker):
        """Replacing with None should set is_layered to False."""
        trade = create_trade(
            db_session,
            ticker="AAPL",
            entry_price=100.0,
            units=100,
            date_planned=date.today(),
            exit_levels=[
                {"level_type": "tp", "price": 110.0, "units_pct": 1.0},
                {"level_type": "sl", "price": 95.0, "units_pct": 1.0},
            ],
        )

        created, is_layered = replace_exit_levels(db_session, trade.id, None)

        assert is_layered is False
        assert len(created) == 0

    def test_preserves_hit_levels(self, db_session, aapl_ticker):
        """Replacing levels should preserve HIT levels."""
        trade = create_trade(
            db_session,
            ticker="AAPL",
            entry_price=100.0,
            units=100,
            date_planned=date.today(),
            exit_levels=[
                {"level_type": "tp", "price": 110.0, "units_pct": 0.5},
                {"level_type": "tp", "price": 120.0, "units_pct": 0.5},
                {"level_type": "sl", "price": 95.0, "units_pct": 1.0},
            ],
        )

        # Mark one level as HIT
        tp_level = next(l for l in trade.exit_levels if l.level_type == ExitLevelType.TP)
        tp_level.status = ExitLevelStatus.HIT
        tp_level.hit_date = date.today()
        tp_level.units_closed = 50
        db_session.commit()

        # Replace pending levels with new ones
        new_levels = [
            {"level_type": "tp", "price": 125.0, "units_pct": 1.0},
            {"level_type": "sl", "price": 92.0, "units_pct": 1.0},
        ]
        created, is_layered = replace_exit_levels(db_session, trade.id, new_levels)

        # Should have 2 new levels + 1 preserved HIT level = 3 total
        db_session.refresh(trade)
        assert len(trade.exit_levels) == 3
        hit_levels = [l for l in trade.exit_levels if l.status == ExitLevelStatus.HIT]
        assert len(hit_levels) == 1
        assert hit_levels[0].price == 110.0


class TestUpdateTradeWithExitLevels:
    """Tests for update_trade with exit_levels parameter."""

    def test_update_trade_replaces_exit_levels(self, db_session, aapl_ticker):
        """Updating a trade with new exit_levels should replace existing ones."""
        # Create trade with simple exit levels
        trade = create_trade(
            db_session,
            ticker="AAPL",
            entry_price=100.0,
            stop_loss=95.0,
            take_profit=110.0,
            units=100,
            date_planned=date.today(),
        )
        # All trades now have exit_levels
        assert len(trade.exit_levels) == 2

        # Update with different exit levels
        updated = update_trade(
            db_session,
            trade.id,
            exit_levels=[
                {"level_type": "tp", "price": 105.0, "units_pct": 0.5},
                {"level_type": "tp", "price": 115.0, "units_pct": 0.5},
                {"level_type": "sl", "price": 90.0, "units_pct": 1.0},
            ],
        )

        assert updated.is_layered is True
        assert updated.remaining_units == 100
        assert len(updated.exit_levels) == 3

    def test_update_trade_removes_exit_levels(self, db_session, aapl_ticker):
        """Updating a layered trade with empty exit_levels should set is_layered to False."""
        trade = create_trade(
            db_session,
            ticker="AAPL",
            entry_price=100.0,
            units=100,
            date_planned=date.today(),
            exit_levels=[
                {"level_type": "tp", "price": 110.0, "units_pct": 1.0},
                {"level_type": "sl", "price": 95.0, "units_pct": 1.0},
            ],
        )

        updated = update_trade(db_session, trade.id, exit_levels=[])

        assert updated.is_layered is False

    def test_update_trade_modifies_exit_levels(self, db_session, aapl_ticker):
        """Updating exit_levels should replace existing levels."""
        trade = create_trade(
            db_session,
            ticker="AAPL",
            entry_price=100.0,
            units=100,
            date_planned=date.today(),
            exit_levels=[
                {"level_type": "tp", "price": 110.0, "units_pct": 1.0},
                {"level_type": "sl", "price": 95.0, "units_pct": 1.0},
            ],
        )

        # Update with different levels
        updated = update_trade(
            db_session,
            trade.id,
            exit_levels=[
                {"level_type": "tp", "price": 105.0, "units_pct": 0.5},
                {"level_type": "tp", "price": 115.0, "units_pct": 0.5},
                {"level_type": "sl", "price": 90.0, "units_pct": 1.0},
            ],
        )

        assert len(updated.exit_levels) == 3
        tp_prices = sorted([l.price for l in updated.exit_levels if l.level_type == ExitLevelType.TP])
        assert tp_prices == [105.0, 115.0]

    def test_update_trade_with_other_fields_and_exit_levels(self, db_session, aapl_ticker):
        """Updating both regular fields and exit_levels should work."""
        trade = create_trade(
            db_session,
            ticker="AAPL",
            entry_price=100.0,
            stop_loss=95.0,
            take_profit=110.0,
            units=100,
            date_planned=date.today(),
        )

        updated = update_trade(
            db_session,
            trade.id,
            entry_price=102.0,
            exit_levels=[
                {"level_type": "tp", "price": 112.0, "units_pct": 1.0},
                {"level_type": "sl", "price": 97.0, "units_pct": 1.0},
            ],
        )

        assert updated.entry_price == 102.0
        # stop_loss and take_profit are computed from exit_levels
        assert updated.stop_loss == 97.0
        assert updated.take_profit == 112.0
        assert updated.is_layered is True
        assert len(updated.exit_levels) == 2
