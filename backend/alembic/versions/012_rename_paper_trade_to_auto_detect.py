"""Rename paper_trade to auto_detect.

Revision ID: 012
Revises: 011
Create Date: 2026-04-03

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "012"
down_revision: Union[str, None] = "011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("trades", "paper_trade", new_column_name="auto_detect")
    op.alter_column("fund_events", "paper_trade", new_column_name="auto_detect")


def downgrade() -> None:
    op.alter_column("trades", "auto_detect", new_column_name="paper_trade")
    op.alter_column("fund_events", "auto_detect", new_column_name="paper_trade")
