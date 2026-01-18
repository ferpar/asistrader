"""Add strategy entity and update tickers/trades.

Revision ID: 002
Revises: 001
Create Date: 2025-01-18

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create bias enum
    op.execute("CREATE TYPE bias AS ENUM ('long', 'short', 'neutral')")

    # Create beta enum
    op.execute("CREATE TYPE beta AS ENUM ('low', 'medium', 'high')")

    # Create strategies table
    op.create_table(
        "strategies",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("pe_method", sa.String(), nullable=True),
        sa.Column("sl_method", sa.String(), nullable=True),
        sa.Column("tp_method", sa.String(), nullable=True),
        sa.Column("description", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )

    # Rename ai_success_probability to probability in tickers
    op.alter_column("tickers", "ai_success_probability", new_column_name="probability")

    # Add new columns to tickers
    op.add_column(
        "tickers",
        sa.Column("bias", sa.Enum("long", "short", "neutral", name="bias"), nullable=True),
    )
    op.add_column("tickers", sa.Column("horizon", sa.String(), nullable=True))
    op.add_column(
        "tickers",
        sa.Column("beta", sa.Enum("low", "medium", "high", name="beta"), nullable=True),
    )
    op.add_column("tickers", sa.Column("strategy_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_tickers_strategy_id",
        "tickers",
        "strategies",
        ["strategy_id"],
        ["id"],
    )

    # Add strategy_id to trades
    op.add_column("trades", sa.Column("strategy_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_trades_strategy_id",
        "trades",
        "strategies",
        ["strategy_id"],
        ["id"],
    )


def downgrade() -> None:
    # Remove strategy_id from trades
    op.drop_constraint("fk_trades_strategy_id", "trades", type_="foreignkey")
    op.drop_column("trades", "strategy_id")

    # Remove new columns from tickers
    op.drop_constraint("fk_tickers_strategy_id", "tickers", type_="foreignkey")
    op.drop_column("tickers", "strategy_id")
    op.drop_column("tickers", "beta")
    op.drop_column("tickers", "horizon")
    op.drop_column("tickers", "bias")

    # Rename probability back to ai_success_probability
    op.alter_column("tickers", "probability", new_column_name="ai_success_probability")

    # Drop strategies table
    op.drop_table("strategies")

    # Drop enums
    op.execute("DROP TYPE IF EXISTS beta")
    op.execute("DROP TYPE IF EXISTS bias")
