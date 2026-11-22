"""add baskets and basket_members tables

Baskets are named groups of tickers measured as one unit. Curated Baskets have
no owner and a unique slug the seed reconciles by
(python -m asistrader.db.seed_baskets); Personal Baskets belong to a user.
Membership is current-only.

Revision ID: 027
Revises: 026
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "027"
down_revision: Union[str, None] = "026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "baskets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column(
            "owner_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("slug", sa.String(), nullable=True, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_baskets_owner_user_id", "baskets", ["owner_user_id"])
    op.create_table(
        "basket_members",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "basket_id",
            sa.Integer(),
            sa.ForeignKey("baskets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ticker", sa.String(), sa.ForeignKey("tickers.symbol"), nullable=False),
        sa.UniqueConstraint("basket_id", "ticker", name="uq_basket_members_basket_ticker"),
    )
    op.create_index("ix_basket_members_basket_id", "basket_members", ["basket_id"])


def downgrade() -> None:
    op.drop_index("ix_basket_members_basket_id", table_name="basket_members")
    op.drop_table("basket_members")
    op.drop_index("ix_baskets_owner_user_id", table_name="baskets")
    op.drop_table("baskets")
