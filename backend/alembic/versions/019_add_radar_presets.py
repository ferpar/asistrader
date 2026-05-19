"""Add radar presets.

Revision ID: 019
Revises: 018
Create Date: 2026-05-19

Adds the `radar_preset` table — saved, named radar view configurations,
scoped per user. `config` is an opaque JSON blob holding a sparse partial
of the frontend RadarViewState (only settings that differ from defaults),
so the radar can keep evolving without touching this schema. Preset names
are unique per user.

Downgrade drops the table.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "019"
down_revision: Union[str, None] = "018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "radar_preset",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
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
        sa.UniqueConstraint("user_id", "name", name="uq_radar_preset_user_name"),
    )
    op.create_index("ix_radar_preset_user_id", "radar_preset", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_radar_preset_user_id", table_name="radar_preset")
    op.drop_table("radar_preset")
