"""Add 'canceled' trade status and cancel_reason column.

Revision ID: 009
Revises: 008
Create Date: 2026-03-31

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE tradestatus ADD VALUE 'CANCELED'")
    cancel_reason_enum = sa.Enum(
        "input_error", "market_conditions", "ticker_fundamentals", "other",
        name="cancelreason",
    )
    cancel_reason_enum.create(op.get_bind(), checkfirst=True)
    op.add_column("trades", sa.Column("cancel_reason", cancel_reason_enum, nullable=True))


def downgrade() -> None:
    op.drop_column("trades", "cancel_reason")
    op.execute("DROP TYPE IF EXISTS cancelreason")
    # Move any canceled trades back to plan before removing the enum value
    op.execute("UPDATE trades SET status = 'PLAN' WHERE status = 'CANCELED'")
    op.execute("ALTER TYPE tradestatus RENAME TO tradestatus_old")
    op.execute("CREATE TYPE tradestatus AS ENUM ('PLAN', 'ORDERED', 'OPEN', 'CLOSE')")
    op.execute(
        "ALTER TABLE trades ALTER COLUMN status TYPE tradestatus "
        "USING status::text::tradestatus"
    )
    op.execute("DROP TYPE tradestatus_old")
