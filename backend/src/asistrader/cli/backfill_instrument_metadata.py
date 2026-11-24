"""Manual backfill of instrument metadata for existing tickers.

Usage:
    python -m asistrader.cli.backfill_instrument_metadata [SYMBOL ...]

For every ticker (or only the given symbols) missing its instrument type or
listing country, looks the ticker up on Yahoo and fills what is missing; those
two fields decide a Holding's Asset Class. Complete tickers are skipped.
Then stores every ticker's (or the given symbols') split events, which
Portfolios apply automatically; sync only records the splits in the bars it
fetches, so history loaded before splits were recorded needs this pass.
Events are upserted, so it is safe to rerun.

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
from asistrader.services.market_data_service import backfill_splits
from asistrader.services.ticker_service import backfill_instrument_metadata


def main(argv: list[str] | None = None, session: Session | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="asistrader.cli.backfill_instrument_metadata",
        description="Fill instrument type, listing country and split events on existing tickers.",
    )
    parser.add_argument("symbols", nargs="*", help="Limit to these symbols (default: all).")
    args = parser.parse_args(argv)

    owns_session = session is None
    if session is None:
        session = SessionLocal()
    try:
        result = backfill_instrument_metadata(session, args.symbols or None)
        splits = backfill_splits(session, args.symbols or None)
    finally:
        if owns_session:
            session.close()

    for symbol, meta in result["results"].items():
        print(f"{symbol}: {meta['instrument_type'] or '?'} {meta['listing_country'] or '?'}")
    for symbol, message in result["errors"].items():
        print(f"{symbol}: error: {message}", file=sys.stderr)
    print(f"total: {len(result['results'])} tickers, {len(result['errors'])} errors")
    for symbol, count in splits["results"].items():
        if count:
            print(f"{symbol}: {count} split{'s' if count != 1 else ''}")
    for symbol, message in splits["errors"].items():
        print(f"{symbol}: splits error: {message}", file=sys.stderr)
    print(f"splits: {sum(splits['results'].values())} events, {len(splits['errors'])} errors")
    return 1 if result["errors"] or splits["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
