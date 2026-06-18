"""The "speed" operator: average daily % price change over a trailing window.

This is the Python port of the frontend's `computePriceChanges`
(`frontend/src/domain/radar/indicators.ts`) — the mean of per-bar percentage
changes over the trailing `period` bars. The sweep uses it as a single drift
point estimate to turn a number of days into an expected price move.

Crucially it is **point-in-time**: `trailing_avg_change_pct(closes, end_idx, n)`
uses only closes at indices `<= end_idx`, so a trial entered on bar `end_idx`
never peeks at the future (no lookahead bias).
"""

from __future__ import annotations

import numpy as np


def avg_change_pct(closes: list[float] | np.ndarray, period: int) -> float | None:
    """Mean per-bar % change over the trailing `period` bars of `closes`.

    Mirrors `computePriceChanges` exactly: it looks at the last ``period + 1``
    closes (so there are ``period`` deltas), averaging ``(c[i] - c[i-1]) / c[i-1]``
    and skipping any step where the previous close is 0. Returns ``None`` when
    there are fewer than 2 usable points.
    """
    arr = np.asarray(closes, dtype=float)
    start = max(0, len(arr) - period - 1)
    sl = arr[start:]
    if len(sl) < 2:
        return None

    prev = sl[:-1]
    cur = sl[1:]
    mask = prev != 0
    if not mask.any():
        return None
    return float(np.mean((cur[mask] - prev[mask]) / prev[mask]))


def trailing_avg_change_pct(
    closes: list[float] | np.ndarray, end_idx: int, period: int
) -> float | None:
    """Point-in-time speed as of bar `end_idx` (inclusive).

    Equivalent to `avg_change_pct(closes[: end_idx + 1], period)` — only past
    data is consulted, so this is safe to use for the entry decision in a
    backtest without leaking the future.
    """
    arr = np.asarray(closes, dtype=float)
    if end_idx < 1:
        return None
    return avg_change_pct(arr[: end_idx + 1], period)


def daily_vol(closes: list[float] | np.ndarray, period: int) -> float | None:
    """Std-dev of per-bar % changes over the trailing `period` bars.

    The volatility counterpart of `avg_change_pct`, used to floor out degenerate
    targets that are smaller than normal intrabar noise. Returns ``None`` with
    fewer than 2 usable deltas.
    """
    arr = np.asarray(closes, dtype=float)
    start = max(0, len(arr) - period - 1)
    sl = arr[start:]
    if len(sl) < 2:
        return None
    prev = sl[:-1]
    cur = sl[1:]
    mask = prev != 0
    if mask.sum() < 2:
        return None
    rets = (cur[mask] - prev[mask]) / prev[mask]
    return float(np.std(rets))


def trailing_daily_vol(
    closes: list[float] | np.ndarray, end_idx: int, period: int
) -> float | None:
    """Point-in-time daily volatility as of bar `end_idx` (inclusive)."""
    arr = np.asarray(closes, dtype=float)
    if end_idx < 1:
        return None
    return daily_vol(arr[: end_idx + 1], period)
