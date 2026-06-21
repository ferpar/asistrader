"""Generalized candidate triple-barrier sweep — the shared executable core.

Both automated strategies are configurations of *this* sweep. The single free
variable of the v1 engine (`D2`) is generalized into a **candidate**: one fully
specified barrier geometry tagged by a *scale*.

    candidate = (scale, entry_coef, target_coef, time_barrier)

    drift:  entry = price ± speed·entry_coef        target = speed·target_coef
            (HED: entry_coef = d1 fixed, target_coef ≡ time_barrier — coupled)
    range:  entry = price ± entry_coef·dispersion    target = target_coef·dispersion
            (entry_coef fixed — the d1 analogue; sweep target_coef × time_barrier)

`entry_coef` is a fixed constant *per scale*, so every candidate of a scale shares
one entry price → one fill per entry date for that scale. Fill-rate is therefore
**per scale**. Everything else mirrors `historical_expected_days`: point-in-time
units (no lookahead), frictionless barriers, recency-weighted over a lookback.

Pure: numpy arrays + dates, no DB. See docs/dispersion-momentum-strategy.md.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

import numpy as np

from . import barriers
from .speed import blended_speed, dispersion_pct, trailing_daily_vol

TRADING_DAYS_PER_YEAR = 252

DRIFT = "drift"
RANGE = "range"


@dataclass(frozen=True)
class Candidate:
    """One barrier geometry the sweep evaluates across entry dates."""

    idx: int
    scale: str  # "drift" | "range"
    entry_coef: float  # offset multiplier on the scale unit (the d1 analogue)
    target_coef: float  # TP-move multiplier on the scale unit
    time_barrier: int  # vertical (time) barrier, in bars


@dataclass(frozen=True)
class CandidateSweepConfig:
    plr: float = 1.5
    side: str = "long"  # "long" | "short"
    order_type: str = "limit"  # "limit" | "stop" | "market"
    time_in_effect: str = "gtd"  # "day" | "gtc" | "gtd"
    lookback_years: int = 3
    fill_window: int | None = None
    recency_weighted: bool = True
    min_risk_vol_mult: float = 1.0
    vol_period: int = 50  # window for the daily-vol floor

    # Scales enabled and their parameters. Defaults reproduce HED (drift-only,
    # single 50-bar speed, d1=1, horizons 1..60).
    scales: tuple[str, ...] = (DRIFT,)
    # Blended speed: list of (period, weight). One window of weight 1 == HED.
    speed_windows: tuple[tuple[int, float], ...] = ((50, 1.0),)
    drift_d1: int = 1
    drift_time_barriers: tuple[int, ...] = tuple(range(1, 61))
    # Range scale.
    dispersion_window: int = 30
    range_entry_coef: float = 0.25  # quarter-of-range pullback for the entry
    range_target_coefs: tuple[float, ...] = (0.3, 0.5, 0.8, 1.0)
    range_time_barriers: tuple[int, ...] = (5, 10, 15, 20, 30, 40)

    @property
    def resolved_fill_window(self) -> int:
        if self.fill_window is not None:
            return self.fill_window
        return {"day": 1, "gtd": 10, "gtc": 60}.get(self.time_in_effect, 10)

    @property
    def min_warmup(self) -> int:
        """First entry-date index with enough history for every *enabled* unit.

        Only the scales in use gate warmup — so a drift-only config is not held
        back by the dispersion window (keeps parity with HED's range(speed_period, n)).
        """
        needs = [self.vol_period]
        if DRIFT in self.scales:
            needs += [int(p) for p, _ in self.speed_windows]
        if RANGE in self.scales:
            needs.append(self.dispersion_window)
        return max(needs)


@dataclass
class CandidateStats:
    candidate: Candidate
    n_trials: int  # filled & evaluable
    n_win: int
    n_loss: int
    n_timeout: int
    win_rate: float | None
    expectancy: float | None
    expectancy_per_day: float | None
    avg_return_win: float | None
    mean_days_win: float | None
    std_days_win: float | None
    fill_rate: float  # the per-scale fill-rate for this candidate's scale


@dataclass
class CandidateSweepResult:
    last_bar_date: date
    n_bars: int
    config: CandidateSweepConfig
    candidates: list[Candidate]
    per_candidate: list[CandidateStats]
    scale_fill_rate: dict[str, float]  # filled / attempts, per scale
    scale_attempts: dict[str, int] = field(default_factory=dict)
    scale_filled: dict[str, int] = field(default_factory=dict)
    # Flat per-trial records (filled & evaluable), one element per trial, tagged by
    # candidate index — for the bootstrap over entry dates in recommend.
    trial_entry_idx: np.ndarray = field(default_factory=lambda: np.array([], dtype=int))
    trial_candidate: np.ndarray = field(default_factory=lambda: np.array([], dtype=int))
    trial_outcome: np.ndarray = field(default_factory=lambda: np.array([], dtype=object))
    trial_return: np.ndarray = field(default_factory=lambda: np.array([], dtype=float))
    trial_days: np.ndarray = field(default_factory=lambda: np.array([], dtype=int))
    trial_weight: np.ndarray = field(default_factory=lambda: np.array([], dtype=float))


# --------------------------------------------------------------------- geometry
# Scale-agnostic; shared with the live draft. (HED will delegate to these.)


def entry_price(p: float, k: float, side: str, order_type: str) -> float:
    """Entry level for an order at price `p` with offset magnitude `k`.

    A buy-limit sits below price, a buy-stop above; short mirrors. Market == `p`.
    """
    if order_type == "market":
        return p
    above = (side == "long" and order_type == "stop") or (
        side == "short" and order_type == "limit"
    )
    return p * (1 + k) if above else p * (1 - k)


def fills(side: str, order_type: str, entry: float, high: float, low: float) -> bool:
    """Whether a bar with this high/low would fill the resting order."""
    if order_type == "market":
        return True
    fill_on_rise = (side == "long" and order_type == "stop") or (
        side == "short" and order_type == "limit"
    )
    return high >= entry if fill_on_rise else low <= entry


def barriers_for(entry: float, target: float, plr: float, side: str) -> tuple[float, float]:
    """(tp, sl) prices for a filled trial; `target` is the TP move fraction."""
    risk = target / plr
    if side == "long":
        return entry * (1 + target), entry * (1 - risk)
    return entry * (1 - target), entry * (1 + risk)


def _recency_weights(entry_idx: np.ndarray, last_idx: int, half_life: float) -> np.ndarray:
    age = (last_idx - entry_idx).astype(float)
    return np.power(0.5, age / half_life)


def draft_prices_for_candidate(
    price: float,
    speed: float | None,
    dispersion: float | None,
    cand: Candidate,
    plr: float,
    side: str,
    order_type: str,
) -> dict[str, float] | None:
    """Concrete entry/SL/TP for a live draft of `cand` at the current `price`.

    Same geometry as the sweep: the scale's unit (speed for drift, dispersion for
    range) is scaled by the candidate's entry/target coefficients. Returns ``None``
    if the scale's unit isn't available.
    """
    unit = speed if cand.scale == DRIFT else dispersion
    if unit is None:
        return None
    unit = abs(unit)
    entry = entry_price(price, unit * cand.entry_coef, side, order_type)
    target = unit * cand.target_coef
    tp, sl = barriers_for(entry, target, plr, side)
    return {"entry": entry, "take_profit": tp, "stop_loss": sl}


def build_candidates(cfg: CandidateSweepConfig) -> list[Candidate]:
    """Enumerate the candidate geometries for the enabled scales (drift first)."""
    out: list[Candidate] = []
    i = 0
    if DRIFT in cfg.scales:
        for h in cfg.drift_time_barriers:
            out.append(Candidate(i, DRIFT, float(cfg.drift_d1), float(h), int(h)))
            i += 1
    if RANGE in cfg.scales:
        for tc in cfg.range_target_coefs:
            for h in cfg.range_time_barriers:
                out.append(Candidate(i, RANGE, float(cfg.range_entry_coef), float(tc), int(h)))
                i += 1
    return out


def run_candidate_sweep(
    opens: np.ndarray,
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    dates: list[date],
    config: CandidateSweepConfig,
) -> CandidateSweepResult:
    """Run the generalized triple-barrier sweep over one ticker's daily bars."""
    o = np.asarray(opens, dtype=float)
    h = np.asarray(highs, dtype=float)
    low = np.asarray(lows, dtype=float)
    c = np.asarray(closes, dtype=float)
    n = len(c)
    is_long = config.side == "long"
    fill_window = config.resolved_fill_window

    candidates = build_candidates(config)
    cands_by_scale: dict[str, list[Candidate]] = {}
    for cand in candidates:
        cands_by_scale.setdefault(cand.scale, []).append(cand)

    last_idx = n - 1
    last_date = dates[last_idx] if n else date.min
    cutoff = None
    if n:
        cutoff = last_date.toordinal() - config.lookback_years * 365
    half_life = max(1.0, config.lookback_years * TRADING_DAYS_PER_YEAR / 2.0)

    t_entry_idx: list[int] = []
    t_cand: list[int] = []
    t_outcome: list[str] = []
    t_return: list[float] = []
    t_days: list[int] = []
    scale_attempts: dict[str, int] = {s: 0 for s in config.scales}
    scale_filled: dict[str, int] = {s: 0 for s in config.scales}

    for t in range(config.min_warmup, n):
        if cutoff is not None and dates[t].toordinal() < cutoff:
            continue
        vol = trailing_daily_vol(c, t, config.vol_period)
        p = c[t]

        units: dict[str, float | None] = {}
        if DRIFT in cands_by_scale:
            units[DRIFT] = blended_speed(c, t, config.speed_windows)
        if RANGE in cands_by_scale:
            units[RANGE] = dispersion_pct(h, low, c, t, config.dispersion_window)

        for scale, scale_cands in cands_by_scale.items():
            unit = units.get(scale)
            if unit is None or unit == 0:
                continue
            entry_coef = scale_cands[0].entry_coef  # fixed per scale
            k = abs(unit) * entry_coef
            entry = entry_price(p, k, config.side, config.order_type)
            scale_attempts[scale] += 1

            if config.order_type == "market":
                fill_idx: int | None = t
            else:
                fill_idx = None
                for i in range(t + 1, min(t + 1 + fill_window, n)):
                    if fills(config.side, config.order_type, entry, h[i], low[i]):
                        fill_idx = i
                        break
            if fill_idx is None:
                continue
            scale_filled[scale] += 1

            for cand in scale_cands:
                start = fill_idx + 1
                end = start + cand.time_barrier
                if end > n:
                    continue
                target = abs(unit) * cand.target_coef
                if vol and vol > 0 and (target / config.plr) < config.min_risk_vol_mult * vol:
                    continue
                tp, sl = barriers_for(entry, target, config.plr, config.side)
                res = barriers.evaluate(
                    is_long, entry, sl, tp,
                    o[start:end], h[start:end], low[start:end], c[start:end],
                )
                ret = barriers.trial_return(is_long, entry, res.exit_price)
                days = cand.time_barrier if res.outcome == barriers.TIMEOUT else res.exit_idx + 1

                t_entry_idx.append(t)
                t_cand.append(cand.idx)
                t_outcome.append(res.outcome)
                t_return.append(ret)
                t_days.append(days)

    entry_idx_arr = np.asarray(t_entry_idx, dtype=int)
    cand_arr = np.asarray(t_cand, dtype=int)
    outcome_arr = np.asarray(t_outcome, dtype=object)
    ret_arr = np.asarray(t_return, dtype=float)
    days_arr = np.asarray(t_days, dtype=int)
    weights = (
        _recency_weights(entry_idx_arr, last_idx, half_life)
        if config.recency_weighted and len(entry_idx_arr)
        else np.ones(len(entry_idx_arr), dtype=float)
    )

    scale_fill_rate = {
        s: (scale_filled[s] / scale_attempts[s]) if scale_attempts[s] else 0.0
        for s in config.scales
    }
    per_candidate = _aggregate_per_candidate(
        candidates, scale_fill_rate, cand_arr, outcome_arr, ret_arr, days_arr, weights
    )

    return CandidateSweepResult(
        last_bar_date=last_date,
        n_bars=n,
        config=config,
        candidates=candidates,
        per_candidate=per_candidate,
        scale_fill_rate=scale_fill_rate,
        scale_attempts=dict(scale_attempts),
        scale_filled=dict(scale_filled),
        trial_entry_idx=entry_idx_arr,
        trial_candidate=cand_arr,
        trial_outcome=outcome_arr,
        trial_return=ret_arr,
        trial_days=days_arr,
        trial_weight=weights,
    )


def _wmean(values: np.ndarray, w: np.ndarray) -> float | None:
    tot = w.sum()
    if tot == 0:
        return None
    return float((values * w).sum() / tot)


def _aggregate_per_candidate(
    candidates: list[Candidate],
    scale_fill_rate: dict[str, float],
    cand_arr: np.ndarray,
    outcome: np.ndarray,
    ret: np.ndarray,
    days: np.ndarray,
    weight: np.ndarray,
) -> list[CandidateStats]:
    out: list[CandidateStats] = []
    for cand in candidates:
        fr = scale_fill_rate.get(cand.scale, 0.0)
        m = cand_arr == cand.idx
        n_trials = int(m.sum())
        if n_trials == 0:
            out.append(CandidateStats(cand, 0, 0, 0, 0, None, None, None, None, None, None, fr))
            continue
        ocm = outcome[m]
        r = ret[m]
        d = days[m]
        w = weight[m]
        win_m = ocm == barriers.WIN
        loss_m = ocm == barriers.LOSS
        timeout_m = ocm == barriers.TIMEOUT
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
        std_days_win = float(np.std(d[win_m].astype(float))) if n_win > 1 else None
        out.append(
            CandidateStats(
                candidate=cand,
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
                fill_rate=fr,
            )
        )
    return out
