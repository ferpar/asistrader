"""add adj_close to market_data

Split/dividend-adjusted close stored next to the raw close, used only for
measurement (Momentum Score, Basket Indexes); SL/TP detection keeps using raw
prices (ADR 0002). Existing rows stay NULL until the one-off backfill runs:
python -m asistrader.cli.backfill_adj_close (needs Yahoo, so it can't live in
a migration).

Revision ID: 025
Revises: 024
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "025"
down_revision: Union[str, None] = "024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("market_data", sa.Column("adj_close", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("market_data", "adj_close")
