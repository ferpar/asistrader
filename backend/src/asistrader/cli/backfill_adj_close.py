"""Manual backfill of adjusted closes for market data stored before they existed.

Usage:
    python -m asistrader.cli.backfill_adj_close [SYMBOL ...]

For every ticker (or only the given symbols) with rows whose adjusted close is
NULL, refetches that date span from Yahoo and upserts it. Tickers that are
already complete are skipped, so it is safe to rerun.

The login sync does the same once per ticker it covers
(`market_data_service.repair_ticker_history`); this covers every ticker at
once, e.g. ones no user syncs.

Uses the configured DATABASE_URL.
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy.orm import Session

from asistrader.db.database import SessionLocal
from asistrader.services.market_data_service import backfill_adjusted_closes


def main(argv: list[str] | None = None, session: Session | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="asistrader.cli.backfill_adj_close",
        description="Fill adjusted closes on existing market data rows.",
    )
    parser.add_argument("symbols", nargs="*", help="Limit to these symbols (default: all).")
    args = parser.parse_args(argv)

    owns_session = session is None
    if session is None:
        session = SessionLocal()
    try:
        result = backfill_adjusted_closes(session, args.symbols or None)
    finally:
        if owns_session:
            session.close()

    for symbol, rows in result["results"].items():
        print(f"{symbol}: {rows} rows")
    for symbol, message in result["errors"].items():
        print(f"{symbol}: error: {message}", file=sys.stderr)
    print(f"total: {result['total_rows']} rows, {len(result['errors'])} errors")
    return 1 if result["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
