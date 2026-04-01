"""Add order_type, time_in_effect, and gtd_date columns.

Revision ID: 010
Revises: 009
Create Date: 2026-03-31

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "010"
down_revision: Union[str, None] = "009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    order_type_enum = sa.Enum("limit", "stop", "market", name="ordertype")
    order_type_enum.create(op.get_bind(), checkfirst=True)
    time_in_effect_enum = sa.Enum("day", "gtc", "gtd", name="timeineffect")
    time_in_effect_enum.create(op.get_bind(), checkfirst=True)

    op.add_column("trades", sa.Column("order_type", order_type_enum, nullable=True))
    op.add_column("trades", sa.Column("time_in_effect", time_in_effect_enum, nullable=True))
    op.add_column("trades", sa.Column("gtd_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("trades", "gtd_date")
    op.drop_column("trades", "time_in_effect")
    op.drop_column("trades", "order_type")
    op.execute("DROP TYPE IF EXISTS timeineffect")
    op.execute("DROP TYPE IF EXISTS ordertype")
