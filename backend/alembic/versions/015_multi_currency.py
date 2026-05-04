"""Add fx_rates, fund_events.currency, user_fund_settings.base_currency.

Revision ID: 015
Revises: 014
Create Date: 2026-05-03

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "015"
down_revision: Union[str, None] = "014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user_fund_settings",
        sa.Column(
            "base_currency",
            sa.String(length=3),
            nullable=False,
            server_default="USD",
        ),
    )
    op.add_column(
        "fund_events",
        sa.Column(
            "currency",
            sa.String(length=3),
            nullable=False,
            server_default="USD",
        ),
    )

    op.create_table(
        "fx_rates",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("rate_to_usd", sa.Float(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("currency", "date", name="uq_fx_rates_currency_date"),
    )
    op.create_index(
        "ix_fx_rates_currency_date",
        "fx_rates",
        ["currency", "date"],
    )


def downgrade() -> None:
    op.drop_index("ix_fx_rates_currency_date", table_name="fx_rates")
    op.drop_table("fx_rates")
    op.drop_column("fund_events", "currency")
    op.drop_column("user_fund_settings", "base_currency")
