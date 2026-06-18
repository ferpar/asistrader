"""The "historical-expected-days" sweep engine.

For a ticker's daily history, replay every (entry date x D2) combination as a
hypothetical trade and record the outcome by walking the actual subsequent path
(triple-barrier). The result feeds `recommend.py`, which turns the per-D2 curves
into regular/aggressive/conservative presets.

Pure: operates on numpy arrays + dates, no DB. See docs/automated-strategies.md.

Key conventions (settled in design):
- speed = point-in-time trailing avg daily % change (single drift point estimate);
  the outcome spread comes from sweeping entry dates, not from a speed band.
- entry = P*(1 ± speed*D1); offset direction from (side, order_type). D1 default 1.
- D2 both sizes the TP (= speed*D2 move) and is the time/vertical barrier.
- SL from PLR (default 1.5). Frictionless (no detection margin) for v1.
- recency-weighted over a (default 3y) lookback.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

import numpy as np

from . import barriers
from .speed import trailing_avg_change_pct, trailing_daily_vol

TRADING_DAYS_PER_YEAR = 252


@dataclass(frozen=True)
class SweepConfig:
    plr: float = 1.5
    d1: int = 1
    d2_min: int = 1
    d2_max: int = 60
    lookback_years: int = 3
    speed_period: int = 50
    side: str = "long"  # "long" | "short"
    order_type: str = "limit"  # "limit" | "stop" | "market"
    time_in_effect: str = "gtd"  # "day" | "gtc" | "gtd"
    fill_window: int | None = None  # bars to wait for a fill; derived from TIE if None
    recency_weighted: bool = True
    # Skip trials whose stop (risk) distance is smaller than this many trailing
    # daily volatilities — drops degenerate horizons whose TP/SL sit inside a
    # single bar's range (where outcomes are intrabar-tiebreak noise, not edge).
    min_risk_vol_mult: float = 1.0

    @property
    def d2_values(self) -> list[int]:
        return list(range(self.d2_min, self.d2_max + 1))

    @property
    def resolved_fill_window(self) -> int:
        if self.fill_window is not None:
            return self.fill_window
        # Map time-in-effect to how many bars an unfilled order stays live.
        return {"day": 1, "gtd": 10, "gtc": 60}.get(self.time_in_effect, 10)


@dataclass
class D2Stats:
    d2: int
    n_trials: int  # filled & evaluable (enough forward bars)
    n_win: int
    n_loss: int
    n_timeout: int
    win_rate: float | None  # wins / n_trials
    expectancy: float | None  # weighted mean return over all filled trials
    expectancy_per_day: float | None
    avg_return_win: float | None
    mean_days_win: float | None
    std_days_win: float | None


@dataclass
class SweepResult:
    ticker: str
    last_bar_date: date
    n_bars: int
    n_attempts: int  # entry dates with a valid speed
    n_filled: int
    fill_rate: float  # filled / attempts (independent of D2)
    config: SweepConfig
    per_d2: list[D2Stats]
    # Flat per-trial records (filled & evaluable), for bootstrap over entry dates
    # in recommend.py. Parallel arrays, one element per trial.
    trial_entry_idx: np.ndarray = field(default_factory=lambda: np.array([], dtype=int))
    trial_d2: np.ndarray = field(default_factory=lambda: np.array([], dtype=int))
    trial_outcome: np.ndarray = field(default_factory=lambda: np.array([], dtype=object))
    trial_return: np.ndarray = field(default_factory=lambda: np.array([], dtype=float))
    trial_days: np.ndarray = field(default_factory=lambda: np.array([], dtype=int))
    trial_weight: np.ndarray = field(default_factory=lambda: np.array([], dtype=float))


def entry_price(p: float, k: float, side: str, order_type: str) -> float:
    """Entry level for an order placed at price `p` with offset magnitude `k`.

    Direction is determined by (side, order_type): a buy-limit sits below price,
    a buy-stop above; short mirrors. Market enters at `p`.
    """
    if order_type == "market":
        return p
    # (side, order_type) -> sign of the offset
    above = (side == "long" and order_type == "stop") or (
        side == "short" and order_type == "limit"
    )
    return p * (1 + k) if above else p * (1 - k)


def _fills(side: str, order_type: str, entry: float, high: float, low: float) -> bool:
    """Whether a bar with this high/low would fill the resting order."""
    if order_type == "market":
        return True
    # buy-limit / sell-stop fill on a dip to/through entry; buy-stop / sell-limit on a rise.
    fill_on_rise = (side == "long" and order_type == "stop") or (
        side == "short" and order_type == "limit"
    )
    return high >= entry if fill_on_rise else low <= entry


def _barriers_for(entry: float, target: float, plr: float, side: str) -> tuple[float, float]:
    """(tp, sl) prices for a filled trial. `target` is the TP move fraction."""
    risk = target / plr
    if side == "long":
        return entry * (1 + target), entry * (1 - risk)
    return entry * (1 - target), entry * (1 + risk)


def draft_prices(
    price: float, speed: float, d1: int, d2: int, plr: float, side: str, order_type: str
) -> dict[str, float]:
    """Concrete entry/SL/TP for a live draft at the current `price`.

    Uses the same deterministic geometry as the sweep: entry offset = speed*d1,
    TP move = speed*d2, SL from PLR. Returns absolute prices.
    """
    k = abs(speed) * d1
    entry = entry_price(price, k, side, order_type)
    target = abs(speed) * d2
    tp, sl = _barriers_for(entry, target, plr, side)
    return {"entry": entry, "take_profit": tp, "stop_loss": sl}


def _recency_weights(entry_idx: np.ndarray, last_idx: int, half_life: float) -> np.ndarray:
    """Exponential recency weight in (0, 1]; newest bar weighs 1."""
    age = (last_idx - entry_idx).astype(float)
    return np.power(0.5, age / half_life)


def run_sweep(
    opens: np.ndarray,
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    dates: list[date],
    config: SweepConfig,
) -> SweepResult:
    """Run the historical triple-barrier sweep over one ticker's daily bars.

    `opens/highs/lows/closes` are aligned numpy arrays; `dates[i]` is the trading
    date of bar `i` (ascending). Returns aggregate per-D2 stats plus flat
    per-trial arrays for downstream bootstrapping.
    """
    o = np.asarray(opens, dtype=float)
    h = np.asarray(highs, dtype=float)
    low = np.asarray(lows, dtype=float)
    c = np.asarray(closes, dtype=float)
    n = len(c)
    is_long = config.side == "long"
    fill_window = config.resolved_fill_window

    last_idx = n - 1
    last_date = dates[last_idx] if n else date.min
    cutoff = None
    if n:
        cutoff_year_days = config.lookback_years * 365
        cutoff = last_date.toordinal() - cutoff_year_days
    half_life = max(1.0, config.lookback_years * TRADING_DAYS_PER_YEAR / 2.0)

    # Per-trial accumulators.
    t_entry_idx: list[int] = []
    t_d2: list[int] = []
    t_outcome: list[str] = []
    t_return: list[float] = []
    t_days: list[int] = []
    # Per-D2 tallies.
    d2_values = config.d2_values
    tally: dict[int, dict] = {
        d2: {"n": 0, "win": 0, "loss": 0, "timeout": 0, "ret_w": 0.0, "w": 0.0,
             "win_ret": [], "win_days": [], "win_w": []}
        for d2 in d2_values
    }

    n_attempts = 0
    n_filled = 0
    attempt_entry_idx: list[int] = []

    for t in range(config.speed_period, n):
        # Only entry dates within the recency lookback window.
        if cutoff is not None and dates[t].toordinal() < cutoff:
            continue
        speed = trailing_avg_change_pct(c, t, config.speed_period)
        if speed is None or speed == 0:
            continue
        vol = trailing_daily_vol(c, t, config.speed_period)
        n_attempts += 1
        attempt_entry_idx.append(t)

        p = c[t]
        k = abs(speed) * config.d1
        entry = entry_price(p, k, config.side, config.order_type)

        # Find the fill once (independent of D2).
        if config.order_type == "market":
            fill_idx: int | None = t
        else:
            fill_idx = None
            for i in range(t + 1, min(t + 1 + fill_window, n)):
                if _fills(config.side, config.order_type, entry, h[i], low[i]):
                    fill_idx = i
                    break
        if fill_idx is None:
            continue
        n_filled += 1

        for d2 in d2_values:
            # Need d2 forward bars after the fill bar.
            start = fill_idx + 1
            end = start + d2
            if end > n:
                continue  # not enough forward history for this D2
            target = abs(speed) * d2
            # Skip degenerate trials: a stop tighter than ~1 daily vol sits inside
            # a single bar's range, so the outcome is intrabar-tiebreak noise.
            if vol and vol > 0 and (target / config.plr) < config.min_risk_vol_mult * vol:
                continue
            tp, sl = _barriers_for(entry, target, config.plr, config.side)
            res = barriers.evaluate(
                is_long, entry, sl, tp,
                o[start:end], h[start:end], low[start:end], c[start:end],
            )
            ret = barriers.trial_return(is_long, entry, res.exit_price)
            days = d2 if res.outcome == barriers.TIMEOUT else res.exit_idx + 1
            w = 1.0

            t_entry_idx.append(t)
            t_d2.append(d2)
            t_outcome.append(res.outcome)
            t_return.append(ret)
            t_days.append(days)

            tb = tally[d2]
            tb["n"] += 1
            tb["w"] += w
            tb["ret_w"] += ret * w
            if res.outcome == barriers.WIN:
                tb["win"] += 1
                tb["win_ret"].append(ret)
                tb["win_days"].append(days)
                tb["win_w"].append(w)
            elif res.outcome == barriers.LOSS:
                tb["loss"] += 1
            else:
                tb["timeout"] += 1

    entry_idx_arr = np.asarray(t_entry_idx, dtype=int)
    weights = (
        _recency_weights(entry_idx_arr, last_idx, half_life)
        if config.recency_weighted and len(entry_idx_arr)
        else np.ones(len(entry_idx_arr), dtype=float)
    )

    # Recompute weighted per-D2 stats now that we have recency weights.
    per_d2 = _aggregate_per_d2(
        d2_values,
        entry_idx_arr,
        np.asarray(t_d2, dtype=int),
        np.asarray(t_outcome, dtype=object),
        np.asarray(t_return, dtype=float),
        np.asarray(t_days, dtype=int),
        weights,
    )

    fill_rate = (n_filled / n_attempts) if n_attempts else 0.0
    return SweepResult(
        ticker="",
        last_bar_date=last_date,
        n_bars=n,
        n_attempts=n_attempts,
        n_filled=n_filled,
        fill_rate=fill_rate,
        config=config,
        per_d2=per_d2,
        trial_entry_idx=entry_idx_arr,
        trial_d2=np.asarray(t_d2, dtype=int),
        trial_outcome=np.asarray(t_outcome, dtype=object),
        trial_return=np.asarray(t_return, dtype=float),
        trial_days=np.asarray(t_days, dtype=int),
        trial_weight=weights,
    )


def _wmean(values: np.ndarray, w: np.ndarray) -> float | None:
    tot = w.sum()
    if tot == 0:
        return None
    return float((values * w).sum() / tot)


def _aggregate_per_d2(
    d2_values: list[int],
    entry_idx: np.ndarray,
    d2_arr: np.ndarray,
    outcome: np.ndarray,
    ret: np.ndarray,
    days: np.ndarray,
    weight: np.ndarray,
) -> list[D2Stats]:
    out: list[D2Stats] = []
    for d2 in d2_values:
        m = d2_arr == d2
        n_trials = int(m.sum())
        if n_trials == 0:
            out.append(D2Stats(d2, 0, 0, 0, 0, None, None, None, None, None, None))
            continue
        o = outcome[m]
        r = ret[m]
        d = days[m]
        w = weight[m]
        win_m = o == barriers.WIN
        loss_m = o == barriers.LOSS
        timeout_m = o == barriers.TIMEOUT
        n_win = int(win_m.sum())
        win_rate = _wmean(win_m.astype(float), w)
        expectancy = _wmean(r, w)
        exp_day = None
        if expectancy is not None:
            mean_days = _wmean(d.astype(float), w)
            if mean_days and mean_days > 0:
                exp_day = expectancy / mean_days
        avg_return_win = _wmean(r[win_m], w[win_m]) if n_win else None
        mean_days_win = _wmean(d[win_m].astype(float), w[win_m]) if n_win else None
        std_days_win = None
        if n_win > 1:
            std_days_win = float(np.std(d[win_m].astype(float)))
        out.append(
            D2Stats(
                d2=d2,
                n_trials=n_trials,
                n_win=n_win,
                n_loss=int(loss_m.sum()),
                n_timeout=int(timeout_m.sum()),
                win_rate=win_rate,
                expectancy=expectancy,
                expectancy_per_day=exp_day,
                avg_return_win=avg_return_win,
                mean_days_win=mean_days_win,
                std_days_win=std_days_win,
            )
        )
    return out
