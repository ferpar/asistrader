"""Diagnostic trace types for SL/TP/entry detection.

These dataclasses capture what the detector evaluated on each market-data bar
and why it picked (or didn't pick) a hit. They are produced by the
`*_with_trace` variants in `sltp_detection_service` and consumed by the manual
replay CLI (`asistrader.cli.detect`) and by tests that need to assert *why* a
date was chosen, not just that one was.

The detector itself does not depend on these types beyond producing them, so
they can evolve without touching the hot path.
"""

from dataclasses import dataclass, field
from datetime import date
from typing import Any


@dataclass
class LevelCheck:
    """One level evaluated against one bar.

    `threshold` is the post-margin trigger price (level * (1 ± margin)) and is
    what the bar's high/low is actually compared against. `gap` is true when
    the bar opened past the threshold relative to the previous bar's close —
    i.e. the level wasn't touched intraday, it was skipped over the gap.
    """

    key: str          # "sl" | "tp" | "entry" | "sl:1" | "tp:2" | ...
    kind: str         # "sl" | "tp" | "entry"
    side: str         # "long" | "short"
    price: float      # raw level price
    threshold: float  # price after applying margin
    pierced: bool
    gap: bool


@dataclass
class BarEval:
    """A single market-data bar as the detector saw it.

    `decision` summarises what the detector did with this bar; `chosen_keys`
    names which level(s) (if any) it attributed the hit to.
    """

    date: date
    open: float | None
    high: float | None
    low: float | None
    close: float | None
    prev_close: float | None
    checks: list[LevelCheck]
    decision: str           # "skip" | "no_data" | "hit" | "both_hit"
    chosen_keys: list[str] = field(default_factory=list)
    reason: str = ""        # short structured tag, e.g. "first_match" | "both_pierced" | "missing_ohlc"


@dataclass
class ScanTrace:
    """Full scan record for one detector invocation on one trade."""

    kind: str               # "sltp" | "entry" | "layered"
    trade_id: int | None
    side: str               # "long" | "short"
    margin: float
    scan_from: date | None  # first bar date considered (exclusive lower bound is scan_from - 1)
    scan_to: date | None    # last bar date actually evaluated, or None if none
    bars_scanned: int
    bars: list[BarEval]
    verdict: str            # one-line human summary
    extras: dict[str, Any] = field(default_factory=dict)
