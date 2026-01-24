"""Add authentication tables (users, refresh_tokens) and user_id FK to trades.

Revision ID: 004
Revises: 003
Create Date: 2025-01-19

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create users table
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("hashed_password", sa.String(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=True, default=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    # Create refresh_tokens table
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token", sa.String(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=True, default=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
    )
    op.create_index("ix_refresh_tokens_token", "refresh_tokens", ["token"], unique=True)

    # Add user_id column to trades table (nullable for existing data)
    op.add_column("trades", sa.Column("user_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_trades_user_id",
        "trades",
        "users",
        ["user_id"],
        ["id"],
    )


def downgrade() -> None:
    # Remove user_id FK and column from trades
    op.drop_constraint("fk_trades_user_id", "trades", type_="foreignkey")
    op.drop_column("trades", "user_id")

    # Drop refresh_tokens table
    op.drop_index("ix_refresh_tokens_token", table_name="refresh_tokens")
    op.drop_table("refresh_tokens")

    # Drop users table
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
