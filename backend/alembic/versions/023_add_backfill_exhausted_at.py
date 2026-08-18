"""add backfill_exhausted_at to tickers

Records that a backward history fetch for a ticker came back empty, so gap
detection stops re-requesting a range Yahoo has no data for. See
market_data_service.BACKFILL_RETRY_DAYS.

Revision ID: 023
Revises: 022
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "023"
down_revision: Union[str, None] = "022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tickers",
        sa.Column("backfill_exhausted_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tickers", "backfill_exhausted_at")
