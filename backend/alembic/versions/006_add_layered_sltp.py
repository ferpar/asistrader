"""Add layered SL/TP support.

Revision ID: 006
Revises: 005
Create Date: 2026-01-26

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add layered columns to trades table
    op.add_column(
        "trades",
        sa.Column("is_layered", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "trades",
        sa.Column("remaining_units", sa.Integer(), nullable=True),
    )

    # Create exit_levels table
    op.create_table(
        "exit_levels",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("trade_id", sa.Integer(), sa.ForeignKey("trades.id"), nullable=False),
        sa.Column("level_type", sa.Enum("sl", "tp", name="exitleveltype"), nullable=False),
        sa.Column("price", sa.Float(), nullable=False),
        sa.Column("units_pct", sa.Float(), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("pending", "hit", "cancelled", name="exitlevelstatus"),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("hit_date", sa.Date(), nullable=True),
        sa.Column("units_closed", sa.Integer(), nullable=True),
        sa.Column("move_sl_to_breakeven", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.create_index("ix_exit_levels_trade_id", "exit_levels", ["trade_id"])


def downgrade() -> None:
    op.drop_index("ix_exit_levels_trade_id", table_name="exit_levels")
    op.drop_table("exit_levels")
    op.execute("DROP TYPE IF EXISTS exitlevelstatus")
    op.execute("DROP TYPE IF EXISTS exitleveltype")
    op.drop_column("trades", "remaining_units")
    op.drop_column("trades", "is_layered")
