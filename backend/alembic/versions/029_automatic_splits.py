"""store ticker split events and drop the Split Transaction

Yahoo's `Close` (auto_adjust=False) is already split-adjusted, so a Portfolio
applies splits automatically from the instrument's split events instead of
asking the user to record them. Adds `ticker_splits` (ticker, date, ratio =
new units per old unit), filled by sync from yfinance's "Stock Splits"
column; existing tickers get theirs from the one-off backfill:
python -m asistrader.cli.backfill_instrument_metadata (needs Yahoo, so it
can't live in a migration).

Removes the `split` Transaction kind: existing Split Transactions are deleted
(the same split is now applied from `ticker_splits`) and
`portfolio_transactions.split_ratio` is dropped. Downgrade restores the
column empty; deleted Split Transactions are not restored.

Revision ID: 029
Revises: 028
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "029"
down_revision: Union[str, None] = "028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ticker_splits",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "ticker", sa.String(), sa.ForeignKey("tickers.symbol"), nullable=False
        ),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("ratio", sa.Numeric(28, 10), nullable=False),
        sa.UniqueConstraint("ticker", "date", name="uq_ticker_splits_ticker_date"),
    )
    op.execute("DELETE FROM portfolio_transactions WHERE kind = 'split'")
    op.drop_column("portfolio_transactions", "split_ratio")


def downgrade() -> None:
    op.add_column(
        "portfolio_transactions",
        sa.Column("split_ratio", sa.Numeric(28, 10), nullable=True),
    )
    op.drop_table("ticker_splits")
