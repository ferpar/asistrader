"""Add trades.date_ordered.

Revision ID: 017
Revises: 016
Create Date: 2026-05-16

Adds `trades.date_ordered`, the date capital was committed to the broker
(status -> ordered). This is the start of the holding period used by the
Drivers / IRR analysis ("ordered -> close").

Backfill: existing trades have no recorded ordered date, so we seed it from
`date_planned`. PLAN/CANCELED trades are excluded from IRR analysis anyway,
and any PLAN trade later moved to ORDERED gets date_ordered overwritten with
the real date by the trade service.

Downgrade drops the column.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "017"
down_revision: Union[str, None] = "016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("trades", sa.Column("date_ordered", sa.Date(), nullable=True))
    # Backfill trades that have already moved past PLAN — their capital was
    # committed at some point; date_planned is the best available proxy.
    op.execute(
        """
        UPDATE trades
        SET date_ordered = date_planned
        WHERE date_ordered IS NULL
          AND status IN ('ORDERED', 'OPEN', 'CLOSE')
        """
    )


def downgrade() -> None:
    op.drop_column("trades", "date_ordered")
