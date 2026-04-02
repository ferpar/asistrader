"""Add fund_events and user_fund_settings tables.

Revision ID: 011
Revises: 010
Create Date: 2026-04-01

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ENUM as PG_ENUM

# revision identifiers, used by Alembic.
revision: str = "011"
down_revision: Union[str, None] = "010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use DO block to handle pre-existing type from a previously failed migration
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE fundeventtype AS ENUM ('deposit', 'withdrawal', 'reserve', 'benefit', 'loss');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)

    # Reference the existing PG enum type directly via dialect-specific type
    # to avoid SQLAlchemy's sa.Enum trying to CREATE TYPE again during create_table
    fund_event_type = PG_ENUM(
        "deposit", "withdrawal", "reserve", "benefit", "loss",
        name="fundeventtype",
        create_type=False,
    )

    op.create_table(
        "fund_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("event_type", fund_event_type, nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("trade_id", sa.Integer(), sa.ForeignKey("trades.id"), nullable=True),
        sa.Column("paper_trade", sa.Boolean(), default=False),
        sa.Column("voided", sa.Boolean(), default=False),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("event_date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_fund_events_user_id", "fund_events", ["user_id"])
    op.create_index("ix_fund_events_trade_id", "fund_events", ["trade_id"])

    op.create_table(
        "user_fund_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, unique=True),
        sa.Column("risk_pct", sa.Float(), default=0.02),
    )


def downgrade() -> None:
    op.drop_table("user_fund_settings")
    op.drop_index("ix_fund_events_trade_id", "fund_events")
    op.drop_index("ix_fund_events_user_id", "fund_events")
    op.drop_table("fund_events")
    op.execute("DROP TYPE IF EXISTS fundeventtype")
