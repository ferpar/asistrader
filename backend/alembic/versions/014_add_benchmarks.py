"""Add benchmarks and benchmark_market_data tables.

Revision ID: 014
Revises: 013
Create Date: 2026-04-19

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "014"
down_revision: Union[str, None] = "013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "benchmarks",
        sa.Column("symbol", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("currency", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("symbol"),
    )

    op.create_table(
        "benchmark_market_data",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("benchmark", sa.String(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("open", sa.Float(), nullable=True),
        sa.Column("high", sa.Float(), nullable=True),
        sa.Column("low", sa.Float(), nullable=True),
        sa.Column("close", sa.Float(), nullable=True),
        sa.Column("volume", sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["benchmark"], ["benchmarks.symbol"]),
        sa.UniqueConstraint(
            "benchmark", "date", name="uq_benchmark_market_data_benchmark_date"
        ),
    )
    op.create_index(
        "ix_benchmark_market_data_benchmark_date",
        "benchmark_market_data",
        ["benchmark", "date"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_benchmark_market_data_benchmark_date",
        table_name="benchmark_market_data",
    )
    op.drop_table("benchmark_market_data")
    op.drop_table("benchmarks")
