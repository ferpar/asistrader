"""Add ticker currency and price_hint.

Revision ID: 013
Revises: 012
Create Date: 2026-04-18

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "013"
down_revision: Union[str, None] = "012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tickers", sa.Column("currency", sa.String(), nullable=True))
    op.add_column("tickers", sa.Column("price_hint", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("tickers", "price_hint")
    op.drop_column("tickers", "currency")
