"""Add 'ordered' trade status.

Revision ID: 008
Revises: 007
Create Date: 2026-03-31

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PostgreSQL ADD VALUE for enums cannot run inside a transaction
    op.execute("ALTER TYPE tradestatus ADD VALUE 'ORDERED' BEFORE 'OPEN'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values directly.
    # To downgrade: update any 'ORDERED' trades back to 'PLAN', then recreate the enum.
    op.execute("UPDATE trades SET status = 'PLAN' WHERE status = 'ORDERED'")
    op.execute("ALTER TYPE tradestatus RENAME TO tradestatus_old")
    op.execute("CREATE TYPE tradestatus AS ENUM ('PLAN', 'OPEN', 'CLOSE')")
    op.execute(
        "ALTER TABLE trades ALTER COLUMN status TYPE tradestatus "
        "USING status::text::tradestatus"
    )
    op.execute("DROP TYPE tradestatus_old")
