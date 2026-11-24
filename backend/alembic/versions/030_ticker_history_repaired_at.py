"""record when a ticker's history was repaired

Adds `tickers.history_repaired_at`. The login sync repairs, once per ticker,
what tickers stored before migrations 025, 028 and 029 are missing: adjusted
closes, instrument metadata and split events. All of them need Yahoo, so the
repair runs in the sync, not here; NULL for every existing ticker means each
is repaired the first time a user's sync covers it.

Revision ID: 030
Revises: 029
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "030"
down_revision: Union[str, None] = "029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tickers", sa.Column("history_repaired_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("tickers", "history_repaired_at")
