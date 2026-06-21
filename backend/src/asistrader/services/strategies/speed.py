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


def blended_speed(
    closes: list[float] | np.ndarray,
    end_idx: int,
    windows: list[tuple[int, float]] | list[list[float]],
) -> float | None:
    """Weighted blend of trailing avg daily % change over several windows.

    `windows` is a list of `(period, weight)` pairs — e.g. `[[50, 0.2], [5, 0.8]]`
    weights the slow 50-bar drift 20% and the fast 5-bar drift 80%. The result is
    the weight-normalized mean over the components that have enough history; a
    component that can't be computed (too short) is dropped and the remaining
    weights renormalize. Point-in-time: only closes at indices `<= end_idx` are
    used. A single window of weight 1 reduces to `trailing_avg_change_pct`.
    """
    acc = 0.0
    total_w = 0.0
    for period, weight in windows:
        s = trailing_avg_change_pct(closes, end_idx, int(period))
        if s is None:
            continue
        acc += float(weight) * s
        total_w += float(weight)
    if total_w == 0:
        return None
    return acc / total_w


def dispersion_pct(
    highs: list[float] | np.ndarray,
    lows: list[float] | np.ndarray,
    closes: list[float] | np.ndarray,
    end_idx: int,
    window: int,
) -> float | None:
    """Trailing high-low range over `window` bars, as a fraction of current price.

    `(max(high) - min(low))` over the trailing `window` bars ending at `end_idx`
    (inclusive), divided by `closes[end_idx]`. The range counterpart of
    `avg_change_pct`: it sizes a target off realized dispersion rather than drift,
    so it stays meaningful in a ranging regime where speed ~ 0. Point-in-time
    (only bars `<= end_idx`). Returns ``None`` with fewer than 2 usable bars or a
    non-positive reference price.
    """
    if end_idx < 1:
        return None
    h = np.asarray(highs, dtype=float)
    low = np.asarray(lows, dtype=float)
    c = np.asarray(closes, dtype=float)
    start = max(0, end_idx - window + 1)
    hi = h[start : end_idx + 1]
    lo = low[start : end_idx + 1]
    if len(hi) < 2:
        return None
    price = c[end_idx]
    if not np.isfinite(price) or price <= 0:
        return None
    rng = float(np.nanmax(hi) - np.nanmin(lo))
    if not np.isfinite(rng) or rng < 0:
        return None
    return rng / price
