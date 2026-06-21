"""The "historical-expected-days" sweep — now a drift-only configuration of the
generalized candidate engine (`candidate_sweep`).

This module keeps HED's stable surface — `SweepConfig`, `SweepResult`, `D2Stats`,
`draft_prices` — and adapts it onto the shared core: `run_sweep` builds a
drift-only `CandidateSweepConfig`, runs the one sweep loop, and maps the
candidate results back to the per-D2 shape its callers and tests expect.

Key conventions (unchanged, settled in design):
- speed = point-in-time trailing avg daily % change (single drift point estimate);
  the outcome spread comes from sweeping entry dates, not from a speed band.
- entry = P*(1 ± speed*D1); offset direction from (side, order_type). D1 default 1.
- D2 both sizes the TP (= speed*D2 move) and is the time/vertical barrier.
- SL from PLR (default 1.5). Frictionless (no detection margin) for v1.
- recency-weighted over a (default 3y) lookback.

See docs/automated-strategies.md and docs/dispersion-momentum-strategy.md.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

import numpy as np

from .candidate_sweep import (
    DRIFT,
    CandidateSweepConfig,
    barriers_for,
    entry_price,
    run_candidate_sweep,
)

__all__ = [
    "SweepConfig",
    "D2Stats",
    "SweepResult",
    "entry_price",
    "draft_prices",
    "run_sweep",
]


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
    tp, sl = barriers_for(entry, target, plr, side)
    return {"entry": entry, "take_profit": tp, "stop_loss": sl}


def _to_core_config(config: SweepConfig) -> CandidateSweepConfig:
    """A drift-only candidate config geometrically identical to this HED config."""
    return CandidateSweepConfig(
        plr=config.plr,
        side=config.side,
        order_type=config.order_type,
        time_in_effect=config.time_in_effect,
        lookback_years=config.lookback_years,
        fill_window=config.fill_window,
        recency_weighted=config.recency_weighted,
        min_risk_vol_mult=config.min_risk_vol_mult,
        vol_period=config.speed_period,
        scales=(DRIFT,),
        speed_windows=((config.speed_period, 1.0),),
        drift_d1=config.d1,
        drift_time_barriers=tuple(config.d2_values),
    )


def run_sweep(
    opens: np.ndarray,
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    dates: list[date],
    config: SweepConfig,
) -> SweepResult:
    """Run the historical triple-barrier sweep over one ticker's daily bars.

    Drift-only delegation to `candidate_sweep.run_candidate_sweep`, mapped back to
    the per-D2 `SweepResult` surface.
    """
    core = run_candidate_sweep(opens, highs, lows, closes, dates, _to_core_config(config))

    per_d2 = [
        D2Stats(
            d2=st.candidate.time_barrier,
            n_trials=st.n_trials,
            n_win=st.n_win,
            n_loss=st.n_loss,
            n_timeout=st.n_timeout,
            win_rate=st.win_rate,
            expectancy=st.expectancy,
            expectancy_per_day=st.expectancy_per_day,
            avg_return_win=st.avg_return_win,
            mean_days_win=st.mean_days_win,
            std_days_win=st.std_days_win,
        )
        for st in core.per_candidate
    ]
    if len(core.trial_candidate):
        tb_of = {c.idx: c.time_barrier for c in core.candidates}
        trial_d2 = np.array([tb_of[int(k)] for k in core.trial_candidate], dtype=int)
    else:
        trial_d2 = np.array([], dtype=int)

    return SweepResult(
        ticker="",
        last_bar_date=core.last_bar_date,
        n_bars=core.n_bars,
        n_attempts=core.scale_attempts.get(DRIFT, 0),
        n_filled=core.scale_filled.get(DRIFT, 0),
        fill_rate=core.scale_fill_rate.get(DRIFT, 0.0),
        config=config,
        per_d2=per_d2,
        trial_entry_idx=core.trial_entry_idx,
        trial_d2=trial_d2,
        trial_outcome=core.trial_outcome,
        trial_return=core.trial_return,
        trial_days=core.trial_days,
        trial_weight=core.trial_weight,
    )
