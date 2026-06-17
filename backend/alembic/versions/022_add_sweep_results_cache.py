"""Add sweep_results cache table.

Revision ID: 022
Revises: 021
Create Date: 2026-06-17

Caches the output of an automated-strategy sweep per (ticker, params_hash,
last_bar_date). The sweep is deterministic given those, so a row stays valid
until a newer MarketData bar lands. See docs/automated-strategies.md.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "022"
down_revision: Union[str, None] = "021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sweep_results",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ticker", sa.String(), sa.ForeignKey("tickers.symbol"), nullable=False),
        sa.Column("params_hash", sa.String(), nullable=False),
        sa.Column("last_bar_date", sa.Date(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "ticker", "params_hash", "last_bar_date", name="uq_sweep_results_key"
        ),
    )
    op.create_index("ix_sweep_results_ticker", "sweep_results", ["ticker"])


def downgrade() -> None:
    op.drop_index("ix_sweep_results_ticker", table_name="sweep_results")
    op.drop_table("sweep_results")
