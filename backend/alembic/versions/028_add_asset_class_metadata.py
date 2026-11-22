"""add asset class metadata to tickers and home market to user settings

Tickers gain the inputs of a Holding's Asset Class: the instrument type
(yfinance quoteType: "stock", "etf", ...), the ISO-2 country of the listing
venue (from yfinance `market`, e.g. "es_market" → "ES") and an optional global
Asset Class override. Users gain a Home Market (ISO-2, default "ES"): a stock
listed there is a Domestic Stock. Existing tickers stay NULL until the one-off
backfill runs: python -m asistrader.cli.backfill_instrument_metadata (needs
Yahoo, so it can't live in a migration).

Revision ID: 028
Revises: 027
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "028"
down_revision: Union[str, None] = "027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tickers", sa.Column("instrument_type", sa.String(16), nullable=True))
    op.add_column("tickers", sa.Column("listing_country", sa.String(2), nullable=True))
    op.add_column(
        "tickers", sa.Column("asset_class_override", sa.String(32), nullable=True)
    )
    op.add_column(
        "user_fund_settings",
        sa.Column("home_market", sa.String(2), nullable=False, server_default="ES"),
    )


def downgrade() -> None:
    op.drop_column("user_fund_settings", "home_market")
    op.drop_column("tickers", "asset_class_override")
    op.drop_column("tickers", "listing_country")
    op.drop_column("tickers", "instrument_type")
