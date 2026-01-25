"""Add paper_trade column to trades table.

Revision ID: 005
Revises: 004
Create Date: 2025-01-25

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "trades",
        sa.Column("paper_trade", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("trades", "paper_trade")
