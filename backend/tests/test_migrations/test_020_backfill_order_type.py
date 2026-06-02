"""Tests for migration 020: backfill NULL order_type -> limit.

Loads the real migration module and runs its `upgrade()` against the test
session's connection (via an Alembic Operations context), so the assertions
exercise the exact SQL that ships in the migration rather than a copy.
"""

import importlib.util
from datetime import date
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.orm import Session

from asistrader.models.db import OrderType, Trade, TradeStatus

MIGRATION_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "020_backfill_null_order_type_limit.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location("migration_020", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _make_trade(number: int, status: TradeStatus, order_type: OrderType | None) -> Trade:
    return Trade(
        number=number,
        ticker="ASML",
        status=status,
        amount=1000.0,
        units=10,
        entry_price=100.0,
        date_planned=date(2025, 1, 15),
        order_type=order_type,
        remaining_units=10,
    )


def _run_upgrade(db_session: Session) -> None:
    migration = _load_migration()
    ctx = MigrationContext.configure(connection=db_session.connection())
    with Operations.context(ctx):
        migration.upgrade()


@pytest.mark.usefixtures("sample_ticker")
def test_backfills_non_terminal_null_trades(db_session: Session) -> None:
    """PLAN/ORDERED/OPEN trades with NULL order_type become 'limit'."""
    plan = _make_trade(1, TradeStatus.PLAN, None)
    ordered = _make_trade(2, TradeStatus.ORDERED, None)
    open_ = _make_trade(3, TradeStatus.OPEN, None)
    db_session.add_all([plan, ordered, open_])
    db_session.commit()

    _run_upgrade(db_session)

    for trade in (plan, ordered, open_):
        db_session.refresh(trade)
        assert trade.order_type == OrderType.LIMIT


@pytest.mark.usefixtures("sample_ticker")
def test_leaves_terminal_trades_null(db_session: Session) -> None:
    """CLOSE/CANCELED trades with NULL order_type are left untouched."""
    closed = _make_trade(1, TradeStatus.CLOSE, None)
    canceled = _make_trade(2, TradeStatus.CANCELED, None)
    db_session.add_all([closed, canceled])
    db_session.commit()

    _run_upgrade(db_session)

    for trade in (closed, canceled):
        db_session.refresh(trade)
        assert trade.order_type is None


@pytest.mark.usefixtures("sample_ticker")
def test_does_not_overwrite_existing_order_type(db_session: Session) -> None:
    """A non-NULL order_type on an open trade is preserved, not reset to limit."""
    stop_trade = _make_trade(1, TradeStatus.OPEN, OrderType.STOP)
    db_session.add(stop_trade)
    db_session.commit()

    _run_upgrade(db_session)

    db_session.refresh(stop_trade)
    assert stop_trade.order_type == OrderType.STOP
