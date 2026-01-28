"""Migrate to exit_levels only system.

Phase 1: Create exit_levels for all trades that don't have them
Phase 2: Set remaining_units for all trades
Phase 3: Drop stop_loss and take_profit columns

Revision ID: 007
Revises: 006
Create Date: 2026-01-26

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # Phase 1: Create exit_levels for trades without them
    trades = conn.execute(
        text(
            """
        SELECT t.id, t.stop_loss, t.take_profit, t.units, t.status,
               t.exit_type, t.exit_date
        FROM trades t
        LEFT JOIN exit_levels el ON t.id = el.trade_id
        WHERE el.id IS NULL
    """
        )
    ).fetchall()

    for trade in trades:
        trade_id, stop_loss, take_profit, units, status, exit_type, exit_date = trade

        if str(status) == "close":
            sl_status = "hit" if exit_type == "sl" else "cancelled"
            tp_status = "hit" if exit_type == "tp" else "cancelled"
            hit_date = exit_date
            units_closed = units
        else:
            sl_status = "pending"
            tp_status = "pending"
            hit_date = None
            units_closed = None

        # Create SL exit level
        conn.execute(
            text(
                """
            INSERT INTO exit_levels
            (trade_id, level_type, price, units_pct, order_index, status,
             hit_date, units_closed, move_sl_to_breakeven)
            VALUES (:trade_id, 'sl', :price, 1.0, 1, :status,
                    :hit_date, :units_closed, false)
        """
            ),
            {
                "trade_id": trade_id,
                "price": stop_loss,
                "status": sl_status,
                "hit_date": hit_date if sl_status == "hit" else None,
                "units_closed": units_closed if sl_status == "hit" else None,
            },
        )

        # Create TP exit level
        conn.execute(
            text(
                """
            INSERT INTO exit_levels
            (trade_id, level_type, price, units_pct, order_index, status,
             hit_date, units_closed, move_sl_to_breakeven)
            VALUES (:trade_id, 'tp', :price, 1.0, 1, :status,
                    :hit_date, :units_closed, false)
        """
            ),
            {
                "trade_id": trade_id,
                "price": take_profit,
                "status": tp_status,
                "hit_date": hit_date if tp_status == "hit" else None,
                "units_closed": units_closed if tp_status == "hit" else None,
            },
        )

    # Phase 2: Set remaining_units for all trades that don't have it
    # Cast status to text for comparison to avoid PostgreSQL enum issues
    conn.execute(
        text(
            """
        UPDATE trades
        SET remaining_units = units
        WHERE remaining_units IS NULL AND status::text != 'CLOSE'
    """
        )
    )

    conn.execute(
        text(
            """
        UPDATE trades
        SET remaining_units = 0
        WHERE remaining_units IS NULL AND status::text = 'CLOSE'
    """
        )
    )

    # Phase 3: Drop stop_loss and take_profit columns
    op.drop_column("trades", "stop_loss")
    op.drop_column("trades", "take_profit")


def downgrade() -> None:
    # Re-add columns
    op.add_column("trades", sa.Column("stop_loss", sa.Float(), nullable=True))
    op.add_column("trades", sa.Column("take_profit", sa.Float(), nullable=True))

    conn = op.get_bind()

    # Populate from exit_levels (weighted average)
    conn.execute(
        text(
            """
        UPDATE trades
        SET stop_loss = (
            SELECT SUM(el.price * el.units_pct) / SUM(el.units_pct)
            FROM exit_levels el
            WHERE el.trade_id = trades.id AND el.level_type = 'sl'
        ),
        take_profit = (
            SELECT SUM(el.price * el.units_pct) / SUM(el.units_pct)
            FROM exit_levels el
            WHERE el.trade_id = trades.id AND el.level_type = 'tp'
        )
    """
        )
    )

    # Make columns non-nullable
    op.alter_column("trades", "stop_loss", nullable=False)
    op.alter_column("trades", "take_profit", nullable=False)

    # Delete exit_levels for simple trades (non-layered)
    conn.execute(
        text(
            """
        DELETE FROM exit_levels
        WHERE trade_id IN (
            SELECT t.id FROM trades t WHERE t.is_layered = false
        )
    """
        )
    )
