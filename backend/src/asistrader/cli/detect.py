"""Manual SL/TP/entry detection replay CLI.

Usage:
    python -m asistrader.cli.detect <trade_id> [--margin 0.005] [--json]
    python -m asistrader.cli.detect <trade_id> --sl 92 --tp 118     (what-if; see Phase 2)

Loads a trade from the configured `DATABASE_URL`, runs the appropriate
`*_with_trace` detector, and prints a bar-by-bar table of how the decision
was made. Read-only: the session is rolled back before close, so nothing the
CLI does can mutate the database.

Routing rules:
  - status=ORDERED                 -> detect_entry_hit_with_trace
  - status=OPEN, is_layered=True   -> detect_layered_hits_with_trace
  - status=OPEN, is_layered=False  -> detect_sltp_hit_with_trace
  - other                          -> trade summary only, no detection
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import sys
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from asistrader.db.database import SessionLocal
from asistrader.models.db import ExitLevelType, Trade, TradeStatus
from asistrader.services.sltp_detection_service import (
    DETECTION_MARGIN_PCT,
    detect_entry_hit_with_trace,
    detect_layered_hits_with_trace,
    detect_sltp_hit_with_trace,
)
from asistrader.services.sltp_detection_trace import BarEval, ScanTrace


def main(argv: list[str] | None = None, session: Session | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="asistrader.cli.detect",
        description="Replay SL/TP/entry detection for a trade with full trace.",
    )
    parser.add_argument("trade_id", type=int, help="Trade ID to inspect.")
    parser.add_argument(
        "--margin", type=float, default=None,
        help=f"Override detection margin (default {DETECTION_MARGIN_PCT}).",
    )
    parser.add_argument(
        "--json", dest="as_json", action="store_true",
        help="Emit the trace as JSON instead of a formatted table.",
    )
    # What-if overrides: applied to the loaded trade in-session, never
    # committed. Useful for "would this date change if SL were 92?" queries.
    parser.add_argument("--sl", type=float, default=None,
                        help="What-if: override SL price (single SL only).")
    parser.add_argument("--tp", type=float, default=None,
                        help="What-if: override TP price (single TP only).")
    parser.add_argument("--entry", type=float, default=None,
                        help="What-if: override entry price.")
    parser.add_argument("--opened", type=date.fromisoformat, default=None,
                        help="What-if: override date_actual (YYYY-MM-DD).")
    parser.add_argument("--planned", type=date.fromisoformat, default=None,
                        help="What-if: override date_planned (YYYY-MM-DD).")
    args = parser.parse_args(argv)

    owns_session = session is None
    if session is None:
        session = SessionLocal()
    try:
        trade = session.get(Trade, args.trade_id)
        if trade is None:
            print(f"error: trade #{args.trade_id} not found", file=sys.stderr)
            return 2

        overrides = _collect_overrides(args)
        if overrides:
            try:
                _apply_what_if(trade, args)
            except ValueError as e:
                print(f"error: {e}", file=sys.stderr)
                return 2

        margin = args.margin if args.margin is not None else DETECTION_MARGIN_PCT
        trace, detector_kind = _run_detector(session, trade, margin)

        if args.as_json:
            payload = _trace_to_dict(trace)
            if overrides:
                payload["what_if"] = overrides
            print(json.dumps(payload, default=_json_default, indent=2))
        else:
            _print_report(trade, trace, detector_kind, margin, overrides)
        return 0
    finally:
        # Read-only contract: never persist anything the CLI did. Rollback
        # covers both detector-side mutations (none today, but cheap safety
        # net) and any future what-if mode that builds detached overrides.
        session.rollback()
        if owns_session:
            session.close()


def _run_detector(
    session: Session, trade: Trade, margin: float
) -> tuple[ScanTrace, str]:
    """Pick the right detector for this trade and run it."""
    if trade.status == TradeStatus.ORDERED:
        _, trace = detect_entry_hit_with_trace(session, trade, margin)
        return trace, "entry"
    if trade.status == TradeStatus.OPEN:
        if trade.is_layered:
            _, trace = detect_layered_hits_with_trace(session, trade, margin)
            return trace, "layered"
        _, trace = detect_sltp_hit_with_trace(session, trade, margin)
        return trace, "sltp"

    # Not in a detectable state — return an empty trace with an explanatory
    # verdict so the report still prints the trade summary cleanly.
    return ScanTrace(
        kind="none",
        trade_id=trade.id,
        side="long",  # placeholder; unused when bars is empty
        margin=margin,
        scan_from=None, scan_to=None, bars_scanned=0, bars=[],
        verdict=f"not detectable: trade.status={trade.status.value}",
    ), "none"


def _collect_overrides(args: argparse.Namespace) -> dict[str, Any]:
    """Pull what-if flags into a flat dict; empty means no overrides."""
    overrides: dict[str, Any] = {}
    for key in ("sl", "tp", "entry", "opened", "planned"):
        v = getattr(args, key)
        if v is not None:
            overrides[key] = v.isoformat() if isinstance(v, date) else v
    return overrides


def _apply_what_if(trade: Trade, args: argparse.Namespace) -> None:
    """Mutate the in-session trade per the override flags. Will be rolled back.

    Raises ValueError when --sl or --tp can't be applied unambiguously (i.e.
    the trade has multiple SL/TP levels). Layered what-ifs would need a
    different flag shape; v1 only supports single-level overrides.
    """
    if args.sl is not None:
        sl_levels = [l for l in trade.exit_levels if l.level_type == ExitLevelType.SL]
        if len(sl_levels) != 1:
            raise ValueError(
                f"--sl needs exactly one SL level; trade has {len(sl_levels)}"
            )
        sl_levels[0].price = args.sl
    if args.tp is not None:
        tp_levels = [l for l in trade.exit_levels if l.level_type == ExitLevelType.TP]
        if len(tp_levels) != 1:
            raise ValueError(
                f"--tp needs exactly one TP level; trade has {len(tp_levels)}"
            )
        tp_levels[0].price = args.tp
    if args.entry is not None:
        trade.entry_price = args.entry
    if args.opened is not None:
        trade.date_actual = args.opened
    if args.planned is not None:
        trade.date_planned = args.planned


def _print_report(
    trade: Trade, trace: ScanTrace, detector_kind: str, margin: float,
    overrides: dict[str, Any],
) -> None:
    print(_header(trade, trace, detector_kind, margin))
    if overrides:
        print(
            "  *** WHAT-IF: "
            + ", ".join(f"{k}={v}" for k, v in overrides.items())
            + " (changes not persisted)"
        )
    if not trace.bars:
        print()
        print(f"Verdict: {trace.verdict}")
        return

    print()
    print(_bars_table(trace))
    print()
    print(f"Verdict: {trace.verdict}")


def _header(trade: Trade, trace: ScanTrace, detector_kind: str, margin: float) -> str:
    side = trace.side.upper()
    status = trade.status.value if trade.status else "?"
    lines = [
        f"Trade #{trade.id}  {trade.ticker}  {side}  status={status}  detector={detector_kind}",
    ]

    # Pull SL/TP/entry depending on shape. stop_loss/take_profit are computed
    # properties on Trade; for layered trades take_profit is a weighted avg,
    # which is fine for the header summary.
    sl = _safe(lambda: trade.stop_loss)
    tp = _safe(lambda: trade.take_profit)
    parts: list[str] = []
    if trade.entry_price is not None:
        parts.append(f"entry={trade.entry_price:g}")
    if sl:
        parts.append(f"SL={sl:g}")
    if tp:
        parts.append(f"TP={tp:g}")
    parts.append(f"margin={margin:g}")
    if trade.order_type:
        parts.append(f"order={trade.order_type.value}")
    if trade.is_layered:
        parts.append(f"layered={len(trade.exit_levels)} levels")
    lines.append("  " + "  ".join(parts))

    date_parts = []
    if trade.date_planned:
        date_parts.append(f"date_planned={trade.date_planned.isoformat()}")
    if trade.date_actual:
        date_parts.append(f"date_actual={trade.date_actual.isoformat()}")
    if date_parts:
        lines.append("  " + "  ".join(date_parts))

    if trace.scan_from and trace.scan_to:
        lines.append(
            f"  scan: {trace.scan_from.isoformat()} → {trace.scan_to.isoformat()}"
            f"  ({trace.bars_scanned} bars)"
        )
    elif trace.bars_scanned == 0 and trace.kind != "none":
        lines.append("  scan: no market data found")

    return "\n".join(lines)


def _bars_table(trace: ScanTrace) -> str:
    """Render trace.bars as a fixed-width table.

    Level columns are derived from the union of `check.key` across all bars,
    sorted to keep simple-trade columns deterministic (sl, tp, entry) and
    layered ones in (sl, tp) by order_index.
    """
    keys = _ordered_keys(trace.bars)

    headers = ["date", "open", "high", "low", "close", "prev"] + keys + ["decision", "reason"]
    rows: list[list[str]] = []
    for bar in trace.bars:
        check_by_key = {c.key: c for c in bar.checks}
        cells = [
            bar.date.isoformat(),
            _fmt_num(bar.open),
            _fmt_num(bar.high),
            _fmt_num(bar.low),
            _fmt_num(bar.close),
            _fmt_num(bar.prev_close),
        ]
        for key in keys:
            cells.append(_fmt_check(check_by_key.get(key)))
        cells.append(bar.decision)
        cells.append(bar.reason or "")
        rows.append(cells)

    return _align_rows(headers, rows)


def _ordered_keys(bars: list[BarEval]) -> list[str]:
    """Stable key ordering across the scan: SLs first (by order_index), then
    TPs, then entry. Layered scans yield keys like 'sl:1', 'tp:2'."""
    seen: list[str] = []
    for bar in bars:
        for c in bar.checks:
            if c.key not in seen:
                seen.append(c.key)

    def sort_key(k: str) -> tuple[int, int]:
        if k == "entry":
            return (2, 0)
        kind, _, idx = k.partition(":")
        kind_order = 0 if kind == "sl" else 1
        try:
            i = int(idx) if idx else 0
        except ValueError:
            i = 0
        return (kind_order, i)

    return sorted(seen, key=sort_key)


def _fmt_check(check: Any) -> str:
    """One-cell summary of a LevelCheck. '·' = not pierced, '✓' = pierced,
    trailing '*' marks a gap. Empty when the level wasn't evaluated."""
    if check is None:
        return ""
    marker = "✓" if check.pierced else "·"
    if check.gap:
        marker += "*"
    return marker


def _fmt_num(v: float | None) -> str:
    if v is None:
        return "-"
    return f"{v:g}"


def _align_rows(headers: list[str], rows: list[list[str]]) -> str:
    widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))

    def line(cells: list[str]) -> str:
        return "  ".join(cell.ljust(widths[i]) for i, cell in enumerate(cells))

    sep = "  ".join("─" * w for w in widths)
    out = [line(headers), sep]
    for row in rows:
        out.append(line(row))
    return "\n".join(out)


def _trace_to_dict(trace: ScanTrace) -> dict[str, Any]:
    """asdict-compatible nested dict for --json output."""
    return dataclasses.asdict(trace)


def _json_default(o: Any) -> Any:
    if isinstance(o, date):
        return o.isoformat()
    raise TypeError(f"not JSON serialisable: {type(o).__name__}")


def _safe(f):
    """Best-effort property read; returns None if SQLAlchemy can't resolve."""
    try:
        return f()
    except Exception:
        return None


if __name__ == "__main__":
    raise SystemExit(main())
