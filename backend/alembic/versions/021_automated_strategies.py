"""Add automated-strategy columns.

Revision ID: 021
Revises: 020
Create Date: 2026-06-17

Adds the surface for automated strategies (see docs/automated-strategies.md):

- strategies.automated      — flag: this strategy's pe/sl/tp_method slots name
                              registered executable derivations (engine in
                              services/strategies/); trades opened through it
                              lock their strategy_id.
- strategies.params         — JSON engine config (PLR default, D1, D2 range,
                              lookback, gates, ...).
- trades.followed_faithfully — for auto-drafted trades: were the suggested
                              prices taken as-is (True) or nudged (False)?
                              Null for manual trades.
- trades.strategy_snapshot  — JSON snapshot of the draft-time recommendation
                              (preset, plr_used, d1, d2, expected stats, CI,
                              sweep_last_bar_date) for realized-vs-expected.

All columns are nullable / defaulted; downgrade drops them.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "021"
down_revision: Union[str, None] = "020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "strategies",
        sa.Column("automated", sa.Boolean(), nullable=False, server_default="0"),
    )
    op.add_column("strategies", sa.Column("params", sa.JSON(), nullable=True))
    op.add_column("trades", sa.Column("followed_faithfully", sa.Boolean(), nullable=True))
    op.add_column("trades", sa.Column("strategy_snapshot", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("trades", "strategy_snapshot")
    op.drop_column("trades", "followed_faithfully")
    op.drop_column("strategies", "params")
    op.drop_column("strategies", "automated")
