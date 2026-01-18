"""Add market_data table for OHLCV data.

Revision ID: 003
Revises: 002
Create Date: 2025-01-18

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "market_data",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("ticker", sa.String(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("open", sa.Float(), nullable=True),
        sa.Column("high", sa.Float(), nullable=True),
        sa.Column("low", sa.Float(), nullable=True),
        sa.Column("close", sa.Float(), nullable=True),
        sa.Column("volume", sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["ticker"], ["tickers.symbol"]),
        sa.UniqueConstraint("ticker", "date", name="uq_market_data_ticker_date"),
    )
    op.create_index(
        "ix_market_data_ticker_date", "market_data", ["ticker", "date"]
    )


def downgrade() -> None:
    op.drop_index("ix_market_data_ticker_date", table_name="market_data")
    op.drop_table("market_data")
