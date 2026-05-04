"""Repair legacy fund_event currencies.

Revision ID: 016
Revises: 015
Create Date: 2026-05-04

Migration 015 added `fund_events.currency` with a server_default of 'USD',
so every legacy row was tagged USD — including reserves and benefit/loss
events linked to trades on non-USD tickers (e.g. .MC / .AS listings priced
in EUR). The numeric `amount` is in the trade's native currency, so
compute_balance over-converts these legacy rows.

This data migration syncs each trade-linked event's currency to its
trade's ticker currency, but only where the event is still on the legacy
'USD' default and the ticker is not USD. Idempotent; safe to re-run if
fresh legacy data appears.

Deposits and withdrawals are NOT touched — those were entered by the user
in the only currency that existed pre-015 (USD), and we have no signal to
suggest they meant otherwise.

Downgrade is a no-op: we cannot reconstruct the original wrong-tag state,
and there's no reason to.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "016"
down_revision: Union[str, None] = "015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


REPAIR_SQL = """
UPDATE fund_events
SET currency = tickers.currency
FROM trades, tickers
WHERE fund_events.trade_id = trades.id
  AND trades.ticker = tickers.symbol
  AND fund_events.event_type IN ('reserve', 'benefit', 'loss')
  AND fund_events.currency = 'USD'
  AND tickers.currency IS NOT NULL
  AND tickers.currency <> 'USD'
"""


def upgrade() -> None:
    op.execute(REPAIR_SQL)


def downgrade() -> None:
    pass
