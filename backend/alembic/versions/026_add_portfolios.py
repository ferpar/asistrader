"""Add portfolios and portfolio transactions.

Revision ID: 026
Revises: 025
Create Date: 2026-11-22

Adds `portfolios` (per-user, name unique per user, currency fixed at
creation) and `portfolio_transactions` (dated Buy/Sell/Split of a ticker).
Portfolios never reference Trades (ADR 0001). Units, prices, fees and FX
rates are Numeric so fractional units are stored exactly; `split_ratio` is
only used by Splits. Holdings are not stored: they are derived by replaying
the Transactions.

Downgrade drops both tables.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "026"
down_revision: Union[str, None] = "025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "portfolios",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("user_id", "name", name="uq_portfolios_user_name"),
    )
    op.create_index("ix_portfolios_user_id", "portfolios", ["user_id"])

    op.create_table(
        "portfolio_transactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "portfolio_id",
            sa.Integer(),
            sa.ForeignKey("portfolios.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column(
            "ticker", sa.String(), sa.ForeignKey("tickers.symbol"), nullable=False
        ),
        sa.Column("units", sa.Numeric(28, 10), nullable=True),
        sa.Column("price", sa.Numeric(28, 10), nullable=True),
        sa.Column("fees", sa.Numeric(28, 10), nullable=False, server_default="0"),
        sa.Column("fx_rate", sa.Numeric(28, 10), nullable=True),
        sa.Column("split_ratio", sa.Numeric(28, 10), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_portfolio_transactions_portfolio_date",
        "portfolio_transactions",
        ["portfolio_id", "date"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_portfolio_transactions_portfolio_date", table_name="portfolio_transactions"
    )
    op.drop_table("portfolio_transactions")
    op.drop_index("ix_portfolios_user_id", table_name="portfolios")
    op.drop_table("portfolios")
