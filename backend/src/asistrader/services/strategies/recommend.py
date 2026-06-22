"""Turn a sweep's per-candidate curves into regular/aggressive/conservative presets.

Candidate-native: the brain operates on the generalized `CandidateSweepResult`
(any mix of drift/range candidates) and picks the best by the *lower bound* of a
block-bootstrap confidence interval (resampling entry dates, preserving
autocorrelation) rather than the raw argmax of a noisy metric — so it prefers a
stable plateau over a lone spike.

Gating: a candidate is only surfaced when its win-rate CI lower bound clears the
break-even floor `1/(1+PLR)` by a margin, it has enough trials, and its efficiency
lower bound is positive. Otherwise → `low_confidence` (best-effort point estimate
still returned, flagged).

Objectives (each preset optimizes a different metric, by design):
- regular      -> capital efficiency  (expectancy/day x fill-rate)
- conservative -> win-rate            (safety; tends to a longer horizon)
- aggressive   -> shortest time barrier (fastest turnover)

`recommend()` keeps the legacy HED entry point: it adapts a `SweepResult` into the
candidate view, delegates here, and maps the presets back to the `.d2` surface its
callers and tests expect. So both automated strategies share this one brain.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import barriers
from .candidate_sweep import (
    Candidate,
    CandidateStats,
    CandidateSweepConfig,
    CandidateSweepResult,
    DRIFT,
)
from .historical_expected_days import SweepResult


@dataclass(frozen=True)
class RecommendConfig:
    min_margin_over_breakeven: float = 0.05
    min_effective_samples: int = 30
    bootstrap_iterations: int = 300
    mean_block: float = 5.0
    ci: float = 0.90
    seed: int = 0


# ----------------------------------------------------------- candidate-native API


@dataclass(frozen=True)
class CandidatePreset:
    kind: str  # "regular" | "conservative" | "aggressive"
    candidate: Candidate
    scale: str
    time_barrier: int
    win_rate: float | None
    expectancy: float | None
    expectancy_per_day: float | None
    efficiency: float | None  # expectancy_per_day * fill_rate (per-scale)
    efficiency_ci: tuple[float, float] | None
    win_rate_ci: tuple[float, float] | None
    n_trials: int
    fill_rate: float


@dataclass(frozen=True)
class CandidateMetric:
    """One candidate's full result — for the compare-all-candidates view."""

    scale: str
    time_barrier: int
    target_coef: float
    entry_coef: float
    blend_label: str | None  # speed-blend variant (drift only)
    n_trials: int
    win_rate: float | None
    win_rate_ci: tuple[float, float] | None
    expectancy_per_day: float | None
    efficiency: float | None
    efficiency_ci: tuple[float, float] | None
    fill_rate: float
    preset_kind: str | None  # which preset (if any) selected this candidate
    confident: bool  # cleared the confidence gate


@dataclass(frozen=True)
class CandidateRecommendation:
    confident: bool
    breakeven_win_rate: float
    scale_fill_rate: dict[str, float]
    presets: dict[str, CandidatePreset]
    reason: str | None
    notes: list[str]
    candidates: list[CandidateMetric]  # every candidate, both scales


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


def _per_candidate_arrays(core: CandidateSweepResult) -> tuple[np.ndarray, dict[int, dict]]:
    """Build, per candidate, date-axis-aligned arrays for fast bootstrap resampling."""
    entry_idx = core.trial_entry_idx
    dates_axis = np.unique(entry_idx) if len(entry_idx) else np.array([], dtype=int)
    pos_of = {int(e): i for i, e in enumerate(dates_axis)}
    n_dates = len(dates_axis)

    per: dict[int, dict] = {}
    for cand in core.candidates:
        per[cand.idx] = {
            "present": np.zeros(n_dates, dtype=bool),
            "ret": np.zeros(n_dates, dtype=float),
            "win": np.zeros(n_dates, dtype=float),
            "days": np.zeros(n_dates, dtype=float),
            "w": np.zeros(n_dates, dtype=float),
        }

    for e, k, outcome, ret, days, w in zip(
        core.trial_entry_idx,
        core.trial_candidate,
        core.trial_outcome,
        core.trial_return,
        core.trial_days,
        core.trial_weight,
    ):
        pos = pos_of[int(e)]
        a = per[int(k)]
        a["present"][pos] = True
        a["ret"][pos] = ret
        a["win"][pos] = 1.0 if outcome == barriers.WIN else 0.0
        a["days"][pos] = days
        a["w"][pos] = w
    return dates_axis, per


def _bootstrap_cis(
    core: CandidateSweepResult, cfg: RecommendConfig
) -> dict[int, dict[str, tuple[float, float]]]:
    """Block-bootstrap CIs (win_rate, efficiency) per candidate by resampling dates.

    Efficiency uses the candidate's own *per-scale* fill-rate (drift and range
    entries fill at different rates), generalizing HED's single sweep fill-rate.
    """
    dates_axis, per = _per_candidate_arrays(core)
    n_dates = len(dates_axis)
    rng = np.random.default_rng(cfg.seed)
    lo_q = (1 - cfg.ci) / 2 * 100
    hi_q = (1 - (1 - cfg.ci) / 2) * 100
    # Each candidate's efficiency uses its own *entry geometry* fill-rate (drift
    # blends and the range entry fill at different rates).
    fill_by_cand = {st.candidate.idx: st.fill_rate for st in core.per_candidate}

    out: dict[int, dict[str, tuple[float, float]]] = {}
    if n_dates == 0:
        return {c.idx: {} for c in core.candidates}

    resamples = [
        _stationary_bootstrap_indices(n_dates, rng, cfg.mean_block)
        for _ in range(cfg.bootstrap_iterations)
    ]

    for cand in core.candidates:
        a = per[cand.idx]
        present, ret, win, days, w = a["present"], a["ret"], a["win"], a["days"], a["w"]
        fill_rate = fill_by_cand[cand.idx]
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
            out[cand.idx] = {
                "win_rate": (float(np.percentile(wr_samples, lo_q)), float(np.percentile(wr_samples, hi_q))),
                "efficiency": (float(np.percentile(eff_samples, lo_q)), float(np.percentile(eff_samples, hi_q))),
            }
        else:
            out[cand.idx] = {}
    return out


def recommend_candidates(
    core: CandidateSweepResult, cfg: RecommendConfig | None = None
) -> CandidateRecommendation:
    """Build the preset recommendation from a completed candidate sweep."""
    cfg = cfg or RecommendConfig()
    plr = core.config.plr
    breakeven = 1.0 / (1.0 + plr)
    notes: list[str] = []

    stats_by_idx: dict[int, CandidateStats] = {
        st.candidate.idx: st for st in core.per_candidate
    }
    cand_by_idx: dict[int, Candidate] = {c.idx: c for c in core.candidates}
    cis = _bootstrap_cis(core, cfg)

    def efficiency(idx: int) -> float | None:
        st = stats_by_idx[idx]
        if st.expectancy_per_day is None:
            return None
        return st.expectancy_per_day * st.fill_rate

    def make_preset(kind: str, idx: int) -> CandidatePreset:
        st = stats_by_idx[idx]
        cand = cand_by_idx[idx]
        ci = cis.get(idx, {})
        return CandidatePreset(
            kind=kind,
            candidate=cand,
            scale=cand.scale,
            time_barrier=cand.time_barrier,
            win_rate=st.win_rate,
            expectancy=st.expectancy,
            expectancy_per_day=st.expectancy_per_day,
            efficiency=efficiency(idx),
            efficiency_ci=ci.get("efficiency"),
            win_rate_ci=ci.get("win_rate"),
            n_trials=st.n_trials,
            fill_rate=st.fill_rate,
        )

    all_idx = [c.idx for c in core.candidates]

    # Confident set: enough samples, win-rate CI lower bound clears break-even by
    # the margin, and efficiency CI lower bound positive.
    confident_idx: list[int] = []
    for idx in all_idx:
        st = stats_by_idx[idx]
        ci = cis.get(idx, {})
        wr_ci = ci.get("win_rate")
        eff_ci = ci.get("efficiency")
        if st.n_trials < cfg.min_effective_samples or wr_ci is None or eff_ci is None:
            continue
        if wr_ci[0] >= breakeven + cfg.min_margin_over_breakeven and eff_ci[0] > 0:
            confident_idx.append(idx)

    confident_set = set(confident_idx)

    def metrics(preset_by_idx: dict[int, str]) -> list[CandidateMetric]:
        out: list[CandidateMetric] = []
        for idx in all_idx:
            st = stats_by_idx[idx]
            cand = cand_by_idx[idx]
            ci = cis.get(idx, {})
            out.append(CandidateMetric(
                scale=cand.scale,
                time_barrier=cand.time_barrier,
                target_coef=cand.target_coef,
                entry_coef=cand.entry_coef,
                blend_label=cand.blend_label,
                n_trials=st.n_trials,
                win_rate=st.win_rate,
                win_rate_ci=ci.get("win_rate"),
                expectancy_per_day=st.expectancy_per_day,
                efficiency=efficiency(idx),
                efficiency_ci=ci.get("efficiency"),
                fill_rate=st.fill_rate,
                preset_kind=preset_by_idx.get(idx),
                confident=idx in confident_set,
            ))
        return out

    confident = bool(confident_idx)
    pool = confident_idx
    if not pool:
        pool = [i for i in all_idx
                if stats_by_idx[i].n_trials >= cfg.min_effective_samples and cis.get(i)]
    if not pool:
        pool = [i for i in all_idx if stats_by_idx[i].n_trials > 0 and cis.get(i)]

    if not pool:
        return CandidateRecommendation(
            confident=False,
            breakeven_win_rate=breakeven,
            scale_fill_rate=core.scale_fill_rate,
            presets={},
            reason=_low_confidence_reason(core, cfg, breakeven),
            notes=notes,
            candidates=metrics({}),
        )

    def eff_low(i: int) -> float:
        return cis[i].get("efficiency", (float("-inf"),))[0]

    def wr_low(i: int) -> float:
        return cis[i].get("win_rate", (float("-inf"),))[0]

    def turnover_key(i: int) -> tuple[int, int]:
        # Shortest time barrier; idx breaks ties deterministically.
        return (cand_by_idx[i].time_barrier, i)

    regular_idx = max(pool, key=eff_low)
    conservative_idx = max(pool, key=wr_low)
    aggressive_idx = min(pool, key=turnover_key)
    # Backstop: keep the three presets distinct/meaningful if conservative
    # collapsed onto the fastest horizon.
    if conservative_idx == aggressive_idx and len(pool) > 1:
        conservative_idx = max(pool, key=lambda i: turnover_key(i))

    presets = {
        "regular": make_preset("regular", regular_idx),
        "conservative": make_preset("conservative", conservative_idx),
        "aggressive": make_preset("aggressive", aggressive_idx),
    }
    preset_by_idx: dict[int, str] = {}
    for kind, pr in presets.items():
        i = pr.candidate.idx
        preset_by_idx[i] = f"{preset_by_idx[i]},{kind}" if i in preset_by_idx else kind
    return CandidateRecommendation(
        confident=confident,
        breakeven_win_rate=breakeven,
        scale_fill_rate=core.scale_fill_rate,
        presets=presets,
        reason=None if confident else _low_confidence_reason(core, cfg, breakeven),
        notes=notes,
        candidates=metrics(preset_by_idx),
    )


def _low_confidence_reason(core: CandidateSweepResult, cfg: RecommendConfig, breakeven: float) -> str:
    if all(fr == 0 for fr in core.scale_fill_rate.values()):
        return "No simulated orders filled — the entry never triggers on this history."
    max_trials = max((st.n_trials for st in core.per_candidate), default=0)
    if max_trials < cfg.min_effective_samples:
        return (
            f"Not enough history: best candidate has {max_trials} trials "
            f"(need >= {cfg.min_effective_samples})."
        )
    return (
        f"No horizon clears the break-even win-rate ({breakeven:.0%}) by the required "
        f"margin with confidence — the edge isn't statistically distinguishable from noise."
    )


# ------------------------------------------------------- legacy HED entry point


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


def hed_to_candidate_result(sweep: SweepResult) -> CandidateSweepResult:
    """Adapt a drift-only HED `SweepResult` into the generalized candidate view."""
    cfg = sweep.config
    d2_values = cfg.d2_values
    candidates = [
        Candidate(i, DRIFT, float(cfg.d1), float(d2), int(d2))
        for i, d2 in enumerate(d2_values)
    ]
    d2_to_idx = {int(d2): i for i, d2 in enumerate(d2_values)}
    stats_by_d2 = {s.d2: s for s in sweep.per_d2}
    per_candidate = [
        CandidateStats(
            candidate=candidates[i],
            n_trials=s.n_trials,
            n_win=s.n_win,
            n_loss=s.n_loss,
            n_timeout=s.n_timeout,
            win_rate=s.win_rate,
            expectancy=s.expectancy,
            expectancy_per_day=s.expectancy_per_day,
            avg_return_win=s.avg_return_win,
            mean_days_win=s.mean_days_win,
            std_days_win=s.std_days_win,
            fill_rate=sweep.fill_rate,
        )
        for i, d2 in enumerate(d2_values)
        for s in (stats_by_d2[d2],)
    ]
    trial_candidate = (
        np.array([d2_to_idx[int(d2)] for d2 in sweep.trial_d2], dtype=int)
        if len(sweep.trial_d2)
        else np.array([], dtype=int)
    )
    core_cfg = CandidateSweepConfig(
        plr=cfg.plr,
        side=cfg.side,
        order_type=cfg.order_type,
        time_in_effect=cfg.time_in_effect,
        lookback_years=cfg.lookback_years,
        min_risk_vol_mult=cfg.min_risk_vol_mult,
        vol_period=cfg.speed_period,
        scales=(DRIFT,),
        speed_windows=((cfg.speed_period, 1.0),),
        drift_d1=cfg.d1,
        drift_time_barriers=tuple(d2_values),
    )
    return CandidateSweepResult(
        last_bar_date=sweep.last_bar_date,
        n_bars=sweep.n_bars,
        config=core_cfg,
        candidates=candidates,
        per_candidate=per_candidate,
        scale_fill_rate={DRIFT: sweep.fill_rate},
        trial_entry_idx=sweep.trial_entry_idx,
        trial_candidate=trial_candidate,
        trial_outcome=sweep.trial_outcome,
        trial_return=sweep.trial_return,
        trial_days=sweep.trial_days,
        trial_weight=sweep.trial_weight,
    )


def recommend(sweep: SweepResult, cfg: RecommendConfig | None = None) -> Recommendation:
    """Legacy HED recommendation: delegate to the candidate brain, map back to D2."""
    cr = recommend_candidates(hed_to_candidate_result(sweep), cfg)

    def to_preset(p: CandidatePreset) -> PresetRec:
        return PresetRec(
            kind=p.kind,
            d2=p.time_barrier,
            win_rate=p.win_rate,
            expectancy=p.expectancy,
            expectancy_per_day=p.expectancy_per_day,
            efficiency=p.efficiency,
            efficiency_ci=p.efficiency_ci,
            win_rate_ci=p.win_rate_ci,
            n_trials=p.n_trials,
        )

    return Recommendation(
        confident=cr.confident,
        breakeven_win_rate=cr.breakeven_win_rate,
        fill_rate=cr.scale_fill_rate.get(DRIFT, 0.0),
        presets={k: to_preset(v) for k, v in cr.presets.items()},
        reason=cr.reason,
        notes=cr.notes,
    )
