"""Turn a sweep's per-D2 curves into regular/aggressive/conservative presets.

Selection is **winner's-curse resistant**: rather than the raw argmax of a noisy
metric, we pick by the *lower bound* of a block-bootstrap confidence interval
(computed by resampling entry dates, preserving autocorrelation). That naturally
prefers a stable plateau over a lone spike.

Gating: a preset is only surfaced when, for its chosen D2, the win-rate CI lower
bound clears the break-even floor `1/(1+PLR)` by a margin, it has enough trials,
and its efficiency lower bound is positive. Otherwise the recommendation is
`low_confidence` (best-effort point estimate still returned, flagged).

Objectives (each preset optimizes a different metric, by design):
- regular      -> capital efficiency  (expectancy/day x fill-rate)
- conservative -> win-rate            (safety; tends to a longer horizon)
- aggressive   -> shortest acceptable D2 (fastest turnover)
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .historical_expected_days import SweepResult


@dataclass(frozen=True)
class RecommendConfig:
    min_margin_over_breakeven: float = 0.05
    min_effective_samples: int = 30
    bootstrap_iterations: int = 300
    mean_block: float = 5.0
    ci: float = 0.90
    seed: int = 0


@dataclass(frozen=True)
class PresetRec:
    kind: str  # "regular" | "conservative" | "aggressive"
    d2: int
    win_rate: float | None
    expectancy: float | None
    expectancy_per_day: float | None
    efficiency: float | None  # expectancy_per_day * fill_rate
    efficiency_ci: tuple[float, float] | None
    win_rate_ci: tuple[float, float] | None
    n_trials: int


@dataclass(frozen=True)
class Recommendation:
    confident: bool
    breakeven_win_rate: float
    fill_rate: float
    presets: dict[str, PresetRec]  # only the kinds that could be formed
    reason: str | None  # populated when not confident
    notes: list[str]


def _stationary_bootstrap_indices(n: int, rng: np.random.Generator, mean_block: float) -> np.ndarray:
    """Stationary-bootstrap a length-n index sequence (geometric block lengths)."""
    p = 1.0 / max(1.0, mean_block)
    idx = np.empty(n, dtype=int)
    cur = int(rng.integers(0, n))
    for i in range(n):
        idx[i] = cur
        if rng.random() < p:
            cur = int(rng.integers(0, n))
        else:
            cur = (cur + 1) % n
    return idx


def _per_date_arrays(sweep: SweepResult) -> tuple[np.ndarray, dict[int, dict]]:
    """Build, per D2, date-axis-aligned arrays for fast bootstrap resampling.

    Returns the sorted unique entry-date axis and, per D2, dicts of present/ret/
    win/days/weight arrays indexed along that axis.
    """
    entry_idx = sweep.trial_entry_idx
    dates_axis = np.unique(entry_idx) if len(entry_idx) else np.array([], dtype=int)
    pos_of = {int(e): i for i, e in enumerate(dates_axis)}
    n_dates = len(dates_axis)

    d2_values = sweep.config.d2_values
    per_d2: dict[int, dict] = {}
    for d2 in d2_values:
        per_d2[d2] = {
            "present": np.zeros(n_dates, dtype=bool),
            "ret": np.zeros(n_dates, dtype=float),
            "win": np.zeros(n_dates, dtype=float),
            "days": np.zeros(n_dates, dtype=float),
            "w": np.zeros(n_dates, dtype=float),
        }

    from . import barriers

    for e, d2, outcome, ret, days, w in zip(
        sweep.trial_entry_idx,
        sweep.trial_d2,
        sweep.trial_outcome,
        sweep.trial_return,
        sweep.trial_days,
        sweep.trial_weight,
    ):
        pos = pos_of[int(e)]
        a = per_d2[int(d2)]
        a["present"][pos] = True
        a["ret"][pos] = ret
        a["win"][pos] = 1.0 if outcome == barriers.WIN else 0.0
        a["days"][pos] = days
        a["w"][pos] = w
    return dates_axis, per_d2


def _bootstrap_cis(
    sweep: SweepResult, cfg: RecommendConfig
) -> dict[int, dict[str, tuple[float, float]]]:
    """Block-bootstrap CIs (win_rate, efficiency) per D2 by resampling entry dates."""
    dates_axis, per_d2 = _per_date_arrays(sweep)
    n_dates = len(dates_axis)
    fill_rate = sweep.fill_rate
    rng = np.random.default_rng(cfg.seed)
    lo_q = (1 - cfg.ci) / 2 * 100
    hi_q = (1 - (1 - cfg.ci) / 2) * 100

    out: dict[int, dict[str, tuple[float, float]]] = {}
    if n_dates == 0:
        return {d2: {} for d2 in sweep.config.d2_values}

    # Pre-generate resample index sets (shared across D2 for consistency).
    resamples = [
        _stationary_bootstrap_indices(n_dates, rng, cfg.mean_block)
        for _ in range(cfg.bootstrap_iterations)
    ]

    for d2 in sweep.config.d2_values:
        a = per_d2[d2]
        present, ret, win, days, w = a["present"], a["ret"], a["win"], a["days"], a["w"]
        wr_samples: list[float] = []
        eff_samples: list[float] = []
        for sel in resamples:
            ws = w[sel] * present[sel]
            tot_w = ws.sum()
            if tot_w <= 0:
                continue
            wr = float((win[sel] * ws).sum() / tot_w)
            day_w = (days[sel] * ws).sum()
            eff = float(fill_rate * (ret[sel] * ws).sum() / day_w) if day_w > 0 else 0.0
            wr_samples.append(wr)
            eff_samples.append(eff)
        if wr_samples:
            out[d2] = {
                "win_rate": (float(np.percentile(wr_samples, lo_q)), float(np.percentile(wr_samples, hi_q))),
                "efficiency": (float(np.percentile(eff_samples, lo_q)), float(np.percentile(eff_samples, hi_q))),
            }
        else:
            out[d2] = {}
    return out


def recommend(sweep: SweepResult, cfg: RecommendConfig | None = None) -> Recommendation:
    """Build the preset recommendation from a completed sweep."""
    cfg = cfg or RecommendConfig()
    plr = sweep.config.plr
    breakeven = 1.0 / (1.0 + plr)
    fill_rate = sweep.fill_rate
    notes: list[str] = []

    stats_by_d2 = {s.d2: s for s in sweep.per_d2}
    cis = _bootstrap_cis(sweep, cfg)

    def efficiency(d2: int) -> float | None:
        s = stats_by_d2[d2]
        if s.expectancy_per_day is None:
            return None
        return s.expectancy_per_day * fill_rate

    def make_preset(kind: str, d2: int) -> PresetRec:
        s = stats_by_d2[d2]
        ci = cis.get(d2, {})
        return PresetRec(
            kind=kind,
            d2=d2,
            win_rate=s.win_rate,
            expectancy=s.expectancy,
            expectancy_per_day=s.expectancy_per_day,
            efficiency=efficiency(d2),
            efficiency_ci=ci.get("efficiency"),
            win_rate_ci=ci.get("win_rate"),
            n_trials=s.n_trials,
        )

    # Confident D2 set: enough samples, win-rate CI lower bound clears break-even
    # by the margin, and efficiency CI lower bound is positive.
    confident_d2: list[int] = []
    for d2 in sweep.config.d2_values:
        s = stats_by_d2[d2]
        ci = cis.get(d2, {})
        wr_ci = ci.get("win_rate")
        eff_ci = ci.get("efficiency")
        if s.n_trials < cfg.min_effective_samples or wr_ci is None or eff_ci is None:
            continue
        if wr_ci[0] >= breakeven + cfg.min_margin_over_breakeven and eff_ci[0] > 0:
            confident_d2.append(d2)

    # Pick the pool the presets are drawn from: the confident set if any horizon
    # cleared the gate, otherwise a best-effort fallback (enough samples to say
    # anything; failing that, any horizon with a CI). We *always* surface all
    # three presets so the user can compare — when not confident they're shown
    # alongside the low-confidence banner, with CIs on each card.
    confident = bool(confident_d2)
    pool = confident_d2
    if not pool:
        pool = [d for d in sweep.config.d2_values
                if stats_by_d2[d].n_trials >= cfg.min_effective_samples and d in cis and cis[d]]
    if not pool:
        pool = [d for d in sweep.config.d2_values
                if stats_by_d2[d].n_trials > 0 and d in cis and cis[d]]

    if not pool:
        # Genuinely nothing to show (no fills / no usable horizons).
        return Recommendation(
            confident=False,
            breakeven_win_rate=breakeven,
            fill_rate=fill_rate,
            presets={},
            reason=_low_confidence_reason(sweep, cfg, breakeven),
            notes=notes,
        )

    def eff_low(d: int) -> float:
        return cis[d].get("efficiency", (float("-inf"),))[0]

    def wr_low(d: int) -> float:
        return cis[d].get("win_rate", (float("-inf"),))[0]

    regular_d2 = max(pool, key=eff_low)        # best capital-efficiency (CI lower bound)
    conservative_d2 = max(pool, key=wr_low)    # safest (highest win-rate CI lower bound)
    aggressive_d2 = min(pool)                  # shortest / fastest horizon
    presets = {
        "regular": make_preset("regular", regular_d2),
        "conservative": make_preset("conservative", conservative_d2),
        "aggressive": make_preset("aggressive", aggressive_d2),
    }
    return Recommendation(
        confident=confident,
        breakeven_win_rate=breakeven,
        fill_rate=fill_rate,
        presets=presets,
        reason=None if confident else _low_confidence_reason(sweep, cfg, breakeven),
        notes=notes,
    )


def _low_confidence_reason(sweep: SweepResult, cfg: RecommendConfig, breakeven: float) -> str:
    if sweep.fill_rate == 0:
        return "No simulated orders filled — the entry never triggers on this history."
    max_trials = max((s.n_trials for s in sweep.per_d2), default=0)
    if max_trials < cfg.min_effective_samples:
        return (
            f"Not enough history: best D2 has {max_trials} trials "
            f"(need >= {cfg.min_effective_samples})."
        )
    return (
        f"No horizon clears the break-even win-rate ({breakeven:.0%}) by the required "
        f"margin with confidence — the edge isn't statistically distinguishable from noise."
    )
