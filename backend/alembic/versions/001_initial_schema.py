"""Initial schema with tickers and trades tables.

Revision ID: 001
Revises:
Create Date: 2025-01-18

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create tickers table
    op.create_table(
        "tickers",
        sa.Column("symbol", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("ai_success_probability", sa.Float(), nullable=True),
        sa.Column("trend_mean_growth", sa.Float(), nullable=True),
        sa.Column("trend_std_deviation", sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint("symbol"),
    )

    # Create trades table
    op.create_table(
        "trades",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=True),
        sa.Column("ticker", sa.String(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("PLAN", "OPEN", "CLOSE", name="tradestatus"),
            nullable=True,
        ),
        sa.Column("amount", sa.Float(), nullable=True),
        sa.Column("units", sa.Integer(), nullable=True),
        sa.Column("entry_price", sa.Float(), nullable=True),
        sa.Column("stop_loss", sa.Float(), nullable=True),
        sa.Column("take_profit", sa.Float(), nullable=True),
        sa.Column("date_planned", sa.Date(), nullable=True),
        sa.Column("date_actual", sa.Date(), nullable=True),
        sa.Column("exit_date", sa.Date(), nullable=True),
        sa.Column("exit_type", sa.Enum("SL", "TP", name="exittype"), nullable=True),
        sa.Column("exit_price", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(
            ["ticker"],
            ["tickers.symbol"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("trades")
    op.drop_table("tickers")
    op.execute("DROP TYPE IF EXISTS tradestatus")
    op.execute("DROP TYPE IF EXISTS exittype")
