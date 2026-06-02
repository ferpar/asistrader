"""Backfill NULL order_type to limit for non-terminal trades.

Revision ID: 020
Revises: 019
Create Date: 2026-06-02

Users sometimes created trades without selecting an order type, leaving
`order_type` NULL. The frontend now defaults to "limit", and the detection
service already treats NULL/market as limit semantics, so this migration
makes that explicit for trades still in the pipeline: PLAN / ORDERED / OPEN
trades with a NULL order_type are set to 'limit'. Terminal trades
(CLOSE / CANCELED) are left untouched so historical records stay as recorded.

Note the casing: `status` stores enum *names* (uppercase, e.g. 'OPEN') while
`order_type` stores enum *values* (lowercase, e.g. 'limit').

Downgrade is a no-op: a pure data backfill can't be reversed because we can't
tell which rows were originally NULL.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "020"
down_revision: Union[str, None] = "019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE trades
        SET order_type = 'limit'
        WHERE order_type IS NULL
          AND status IN ('PLAN', 'ORDERED', 'OPEN')
        """
    )


def downgrade() -> None:
    # Irreversible data backfill: the original NULLs are not recoverable.
    pass
