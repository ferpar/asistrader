"""Add detection margin setting and alert dismissal blacklist.

Revision ID: 018
Revises: 017
Create Date: 2026-05-18

Two related changes for trade auto-detection:

1. `user_fund_settings.detection_margin_pct` — a per-user confirmation
   buffer. A candle must penetrate an SL/TP/entry level by this fraction
   before a hit is confirmed, suppressing grazes within the noise band
   between data sources (Yahoo vs. TradingView). Defaults to 0.005 (0.5%).

2. `alert_dismissal` — a blacklist of discarded alerts. Once a user
   dismisses an alert it stays hidden on subsequent check-alerts runs.
   Keyed on (trade, hit date, alert kind, level) so dismissing one alert
   never suppresses an unrelated one.

Downgrade drops both.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "018"
down_revision: Union[str, None] = "017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user_fund_settings",
        sa.Column(
            "detection_margin_pct",
            sa.Float(),
            nullable=False,
            server_default="0.005",
        ),
    )

    op.create_table(
        "alert_dismissal",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("trade_id", sa.Integer(), sa.ForeignKey("trades.id"), nullable=False),
        sa.Column("ticker", sa.String(), nullable=False),
        sa.Column("hit_date", sa.Date(), nullable=False),
        sa.Column(
            "alert_kind",
            sa.Enum("entry", "sltp", "layered", name="alertkind"),
            nullable=False,
        ),
        sa.Column("level_key", sa.String(), nullable=False),
        sa.Column(
            "dismissed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "trade_id",
            "hit_date",
            "alert_kind",
            "level_key",
            name="uq_alert_dismissal_signature",
        ),
    )
    op.create_index("ix_alert_dismissal_user_id", "alert_dismissal", ["user_id"])
    op.create_index("ix_alert_dismissal_trade_id", "alert_dismissal", ["trade_id"])


def downgrade() -> None:
    op.drop_index("ix_alert_dismissal_trade_id", table_name="alert_dismissal")
    op.drop_index("ix_alert_dismissal_user_id", table_name="alert_dismissal")
    op.drop_table("alert_dismissal")
    op.execute("DROP TYPE IF EXISTS alertkind")
    op.drop_column("user_fund_settings", "detection_margin_pct")
