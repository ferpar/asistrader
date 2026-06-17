"""Frictionless triple-barrier evaluation (independent numpy reimplementation).

This is a deliberate, self-contained reimplementation of the barrier-touch logic
— *not* a call into ``sltp_detection_service`` (which is coupled to Trade/MarketData
ORM objects and derives SL/TP from exit_levels, making it clumsy and slow to call
per hypothetical trial). The conventions are kept identical to the live detector so
results are comparable:

- direction: ``is_long = sl < entry`` (matches ``sltp_detection_service.is_long_trade``)
- long: SL touched when ``low <= sl``; TP when ``high >= tp``. Short mirrors.
- same-bar SL+TP: open-distance tiebreak — whichever barrier is closer to that
  bar's open is assumed hit first; SL wins if the open is missing (matches
  ``_bothday_winner_is_sl``).

A parity test (`test_historical_expected_days.py`) pins this against
``check_sltp_hit_for_day`` at ``margin=0`` to guard against drift.

**Frictionless v1:** no detection margin and no gap fill-pricing — a touch is a
raw high/low crossing and the fill is assumed exactly at the barrier price.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

WIN = "win"
LOSS = "loss"
TIMEOUT = "timeout"


@dataclass(frozen=True)
class BarrierResult:
    """Outcome of one trial over its forward window.

    `exit_idx` is the 0-based offset into the forward window (the bars after the
    fill). For a timeout it points at the last bar (mark-to-close).
    """

    outcome: str  # WIN | LOSS | TIMEOUT
    exit_idx: int
    exit_price: float


def _first_true(mask: np.ndarray) -> int | None:
    """Index of the first True in a boolean array, or None if all False."""
    if mask.any():
        return int(np.argmax(mask))
    return None


def evaluate(
    is_long: bool,
    entry: float,
    sl: float,
    tp: float,
    opens: np.ndarray,
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
) -> BarrierResult:
    """Evaluate a single trial against its forward window (the bars after fill).

    The arrays are the OHLC of the up-to-``D2`` bars following the entry fill.
    Returns the first barrier touched, resolving same-bar conflicts by
    open-distance; a window with no touch is a timeout marked-to-close.
    """
    n = len(highs)
    if n == 0:
        # No forward bars to evaluate — treat as an immediate flat exit.
        return BarrierResult(TIMEOUT, -1, float(entry))

    if is_long:
        tp_touch = highs >= tp
        sl_touch = lows <= sl
    else:
        tp_touch = lows <= tp
        sl_touch = highs >= sl

    first_tp = _first_true(tp_touch)
    first_sl = _first_true(sl_touch)

    if first_tp is None and first_sl is None:
        return BarrierResult(TIMEOUT, n - 1, float(closes[-1]))
    if first_sl is None:
        return BarrierResult(WIN, first_tp, float(tp))
    if first_tp is None:
        return BarrierResult(LOSS, first_sl, float(sl))
    if first_tp < first_sl:
        return BarrierResult(WIN, first_tp, float(tp))
    if first_sl < first_tp:
        return BarrierResult(LOSS, first_sl, float(sl))

    # Same bar pierced both barriers — open-distance tiebreak.
    bar = first_tp
    bar_open = opens[bar]
    sl_wins = np.isnan(bar_open) or abs(bar_open - sl) <= abs(bar_open - tp)
    if sl_wins:
        return BarrierResult(LOSS, bar, float(sl))
    return BarrierResult(WIN, bar, float(tp))


def trial_return(is_long: bool, entry: float, exit_price: float) -> float:
    """Signed P&L as a fraction of entry (positive = profit), per side."""
    if is_long:
        return (exit_price - entry) / entry
    return (entry - exit_price) / entry
