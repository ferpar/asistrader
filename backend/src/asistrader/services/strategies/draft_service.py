"""Draft-a-trade service: resolve a strategy's config, run (or reuse a cached)
sweep for a ticker, and return the preset recommendation plus concrete drafted
prices. DB-coupled glue around the pure engine (sweep + recommend).

Caching: keyed on (ticker, params_hash, last_bar_date). The sweep is
deterministic given those, so a cached row is reused until a newer daily bar
lands. A non-default PLR/D1/order-type is simply a different params_hash.
"""

from __future__ import annotations

import hashlib
import json

import numpy as np
from sqlalchemy.orm import Session

from asistrader.models.db import Strategy, SweepResultCache
from asistrader.services.market_data_service import get_data_bounds, get_market_data

from .candidate_sweep import (
    Candidate,
    CandidateSweepConfig,
    draft_prices_for_candidate,
    run_candidate_sweep,
)
from .engines import get_engine
from .historical_expected_days import SweepConfig, draft_prices, run_sweep
from .recommend import RecommendConfig, recommend, recommend_candidates
from .speed import blended_speed, dispersion_pct, trailing_avg_change_pct


def _resolve(strategy: Strategy, overrides: dict) -> tuple[SweepConfig, RecommendConfig, str, str, str]:
    """Resolve the effective sweep/recommend config from strategy params + request
    overrides. Returns (SweepConfig, RecommendConfig, side, order_type, params_hash).
    """
    p = strategy.params or {}
    gates = p.get("gates", {})

    plr = overrides.get("plr") or p.get("plr_default", 1.5)
    d1 = overrides.get("d1") or p.get("d1_default", 1)
    d2_range = p.get("d2_range", [1, 60])
    lookback = p.get("lookback_years", 3)
    speed_period = p.get("speed_period", 50)
    side = overrides.get("side") or p.get("side_default", "long")
    order_type = overrides.get("order_type") or p.get("order_type_default", "limit")
    tie = overrides.get("time_in_effect") or p.get("time_in_effect_default", "gtd")
    min_risk_vol_mult = p.get("min_risk_vol_mult", 1.0)

    sweep_cfg = SweepConfig(
        plr=float(plr),
        d1=int(d1),
        d2_min=int(d2_range[0]),
        d2_max=int(d2_range[1]),
        lookback_years=int(lookback),
        speed_period=int(speed_period),
        side=side,
        order_type=order_type,
        time_in_effect=tie,
        min_risk_vol_mult=float(min_risk_vol_mult),
    )
    rec_cfg = RecommendConfig(
        min_margin_over_breakeven=float(
            p.get("min_margin_over_breakeven", gates.get("min_margin_over_breakeven", 0.05))
        ),
        min_effective_samples=int(
            p.get("min_effective_samples", gates.get("min_effective_samples", 30))
        ),
    )

    # Stable hash over everything that affects the result.
    hashable = {
        "engine": p.get("engine", "historical_expected_days"),
        "plr": sweep_cfg.plr,
        "d1": sweep_cfg.d1,
        "d2": [sweep_cfg.d2_min, sweep_cfg.d2_max],
        "lookback": sweep_cfg.lookback_years,
        "speed_period": sweep_cfg.speed_period,
        "min_risk_vol_mult": sweep_cfg.min_risk_vol_mult,
        "side": side,
        "order_type": order_type,
        "tie": tie,
        "gates": {
            "m": rec_cfg.min_margin_over_breakeven,
            "n": rec_cfg.min_effective_samples,
        },
    }
    params_hash = hashlib.sha256(
        json.dumps(hashable, sort_keys=True).encode()
    ).hexdigest()[:16]
    return sweep_cfg, rec_cfg, side, order_type, params_hash


def _ci_list(ci: tuple[float, float] | None) -> list[float] | None:
    return [ci[0], ci[1]] if ci else None


def draft_trade(db: Session, strategy: Strategy, overrides: dict) -> dict:
    """Return the draft payload (dict) for a ticker under an automated strategy.

    Dispatches on the bound engine, uses the cache when fresh; otherwise computes,
    caches, and returns.
    """
    ticker = overrides["ticker"]
    p = strategy.params or {}
    engine_id = p.get("engine", "historical_expected_days")
    engine = get_engine(engine_id)
    plr = float(overrides.get("plr") or p.get("plr_default", 1.5))
    breakeven = 1.0 / (1.0 + plr)
    meta = {
        "engine_label": engine.label if engine else None,
        "engine_description": engine.description if engine else None,
    }

    def fail(reason: str, last_bar=None) -> dict:
        return {
            **meta,
            "confident": False,
            "reason": reason,
            "breakeven_win_rate": breakeven,
            "fill_rate": 0.0,
            "ticker": ticker,
            "last_bar_date": last_bar.isoformat() if last_bar else None,
            "speed": None,
            "presets": [],
        }

    if engine is None:
        return fail(f"Unknown strategy engine '{engine_id}'.")

    _, last_bar = get_data_bounds(db, ticker)
    if last_bar is None:
        return fail(f"No market data for {ticker}.")

    # Resolve the engine-specific config + a compute closure.
    if engine_id == "dispersion_momentum":
        cfg, rec_cfg, side, order_type, params_hash = _resolve_dm(strategy, overrides)
        compute = lambda: _compute_dm(  # noqa: E731
            db, ticker, cfg, rec_cfg, side, order_type, breakeven, last_bar
        )
    else:
        sweep_cfg, rec_cfg, side, order_type, params_hash = _resolve(strategy, overrides)
        compute = lambda: _compute(  # noqa: E731
            db, ticker, sweep_cfg, rec_cfg, side, order_type, breakeven, last_bar
        )

    cached = (
        db.query(SweepResultCache)
        .filter(
            SweepResultCache.ticker == ticker,
            SweepResultCache.params_hash == params_hash,
            SweepResultCache.last_bar_date == last_bar,
        )
        .first()
    )
    if cached is not None:
        # Merge meta so older cache rows (pre-meta) still carry the description.
        return {**meta, **cached.payload}

    payload = {**meta, **compute()}

    db.add(
        SweepResultCache(
            ticker=ticker,
            params_hash=params_hash,
            last_bar_date=last_bar,
            payload=payload,
        )
    )
    db.commit()
    return payload


def _compute(db, ticker, sweep_cfg, rec_cfg, side, order_type, breakeven, last_bar) -> dict:
    rows = get_market_data(db, ticker)
    bars = [
        r for r in rows
        if None not in (r.open, r.high, r.low, r.close)
    ]
    base = {
        "breakeven_win_rate": breakeven,
        "ticker": ticker,
        "last_bar_date": last_bar.isoformat(),
        "speed": None,
        "presets": [],
    }
    if len(bars) <= sweep_cfg.speed_period:
        return {**base, "confident": False, "fill_rate": 0.0,
                "reason": "Not enough history to compute a speed estimate."}

    o = np.array([r.open for r in bars], dtype=float)
    h = np.array([r.high for r in bars], dtype=float)
    low = np.array([r.low for r in bars], dtype=float)
    c = np.array([r.close for r in bars], dtype=float)
    dates = [r.date for r in bars]

    sweep = run_sweep(o, h, low, c, dates, sweep_cfg)
    rec = recommend(sweep, rec_cfg)

    price = float(c[-1])
    speed = trailing_avg_change_pct(c, len(c) - 1, sweep_cfg.speed_period)

    presets = []
    if speed is not None:
        for kind, pr in rec.presets.items():
            prices = draft_prices(
                price, speed, sweep_cfg.d1, pr.d2, sweep_cfg.plr, side, order_type
            )
            presets.append({
                "kind": pr.kind,
                "d2": pr.d2,
                "win_rate": pr.win_rate,
                "expectancy": pr.expectancy,
                "expectancy_per_day": pr.expectancy_per_day,
                "efficiency": pr.efficiency,
                "win_rate_ci": _ci_list(pr.win_rate_ci),
                "efficiency_ci": _ci_list(pr.efficiency_ci),
                "n_trials": pr.n_trials,
                "entry": prices["entry"],
                "stop_loss": prices["stop_loss"],
                "take_profit": prices["take_profit"],
            })

    return {
        **base,
        "confident": rec.confident,
        "reason": rec.reason,
        "fill_rate": rec.fill_rate,
        "speed": speed,
        "presets": presets,
    }


# ------------------------------------------------------- dispersion_momentum engine


def _resolve_dm(
    strategy: Strategy, overrides: dict
) -> tuple[CandidateSweepConfig, RecommendConfig, str, str, str]:
    """Resolve the dual-scale candidate config from params + overrides."""
    p = strategy.params or {}

    plr = float(overrides.get("plr") or p.get("plr_default", 1.5))
    d1 = int(overrides.get("d1") or p.get("d1_default", 1))
    d2_range = p.get("d2_range", [1, 60])
    lookback = int(p.get("lookback_years", 3))
    slow = int(p.get("speed_slow_period", 50))
    fast = int(p.get("speed_fast_period", 5))
    w_slow = float(p.get("speed_weight_slow", 0.2))
    dispersion_window = int(p.get("dispersion_window", 30))
    range_entry_coef = float(p.get("range_entry_coef", 0.25))
    scales = tuple(p.get("scales", ["drift", "range"]))
    range_target_coefs = tuple(p.get("range_target_coefs", [0.3, 0.5, 0.8, 1.0]))
    range_time_barriers = tuple(p.get("range_time_barriers", [5, 10, 15, 20, 30, 40]))
    side = overrides.get("side") or p.get("side_default", "long")
    order_type = overrides.get("order_type") or p.get("order_type_default", "limit")
    tie = overrides.get("time_in_effect") or p.get("time_in_effect_default", "gtd")
    min_risk_vol_mult = float(p.get("min_risk_vol_mult", 1.0))

    speed_windows = ((slow, w_slow), (fast, 1.0 - w_slow))
    cfg = CandidateSweepConfig(
        plr=plr,
        side=side,
        order_type=order_type,
        time_in_effect=tie,
        lookback_years=lookback,
        min_risk_vol_mult=min_risk_vol_mult,
        vol_period=slow,
        scales=scales,
        speed_windows=speed_windows,
        drift_d1=d1,
        drift_time_barriers=tuple(range(int(d2_range[0]), int(d2_range[1]) + 1)),
        dispersion_window=dispersion_window,
        range_entry_coef=range_entry_coef,
        range_target_coefs=range_target_coefs,
        range_time_barriers=range_time_barriers,
    )
    rec_cfg = RecommendConfig(
        min_margin_over_breakeven=float(p.get("min_margin_over_breakeven", 0.05)),
        min_effective_samples=int(p.get("min_effective_samples", 30)),
    )

    hashable = {
        "engine": "dispersion_momentum",
        "plr": plr,
        "d1": d1,
        "d2": [int(d2_range[0]), int(d2_range[1])],
        "lookback": lookback,
        "speed_windows": [list(w) for w in speed_windows],
        "dispersion_window": dispersion_window,
        "range_entry_coef": range_entry_coef,
        "scales": list(scales),
        "range_target_coefs": list(range_target_coefs),
        "range_time_barriers": list(range_time_barriers),
        "min_risk_vol_mult": min_risk_vol_mult,
        "side": side,
        "order_type": order_type,
        "tie": tie,
        "gates": {
            "m": rec_cfg.min_margin_over_breakeven,
            "n": rec_cfg.min_effective_samples,
        },
    }
    params_hash = hashlib.sha256(
        json.dumps(hashable, sort_keys=True).encode()
    ).hexdigest()[:16]
    return cfg, rec_cfg, side, order_type, params_hash


def _compute_dm(db, ticker, cfg: CandidateSweepConfig, rec_cfg, side, order_type, breakeven, last_bar) -> dict:
    rows = get_market_data(db, ticker)
    bars = [r for r in rows if None not in (r.open, r.high, r.low, r.close)]
    base = {
        "breakeven_win_rate": breakeven,
        "ticker": ticker,
        "last_bar_date": last_bar.isoformat(),
        "speed": None,
        "dispersion": None,
        "presets": [],
    }
    if len(bars) <= cfg.min_warmup:
        return {**base, "confident": False, "fill_rate": 0.0,
                "reason": "Not enough history to compute the strategy's indicators."}

    o = np.array([r.open for r in bars], dtype=float)
    h = np.array([r.high for r in bars], dtype=float)
    low = np.array([r.low for r in bars], dtype=float)
    c = np.array([r.close for r in bars], dtype=float)
    dates = [r.date for r in bars]

    core = run_candidate_sweep(o, h, low, c, dates, cfg)
    rec = recommend_candidates(core, rec_cfg)

    price = float(c[-1])
    last = len(c) - 1
    speed = blended_speed(c, last, cfg.speed_windows) if "drift" in cfg.scales else None
    disp = dispersion_pct(h, low, c, last, cfg.dispersion_window) if "range" in cfg.scales else None

    presets = []
    for pr in rec.presets.values():
        prices = draft_prices_for_candidate(price, speed, disp, pr.candidate, cfg.plr, side, order_type)
        if prices is None:
            continue
        presets.append({
            "kind": pr.kind,
            "d2": pr.time_barrier,
            "win_rate": pr.win_rate,
            "expectancy": pr.expectancy,
            "expectancy_per_day": pr.expectancy_per_day,
            "efficiency": pr.efficiency,
            "win_rate_ci": _ci_list(pr.win_rate_ci),
            "efficiency_ci": _ci_list(pr.efficiency_ci),
            "n_trials": pr.n_trials,
            "entry": prices["entry"],
            "stop_loss": prices["stop_loss"],
            "take_profit": prices["take_profit"],
            "scale": pr.scale,
            "target_coef": pr.candidate.target_coef,
            "entry_coef": pr.candidate.entry_coef,
        })

    reason = rec.reason
    if "regular" in rec.presets:
        fill_rate = rec.presets["regular"].fill_rate
    else:
        fill_rate = max(core.scale_fill_rate.values(), default=0.0)

    # Low-confidence safety net: nothing cleared the gate but we can still draft a
    # deterministic range trade (the Excel "safe 0.5 of dispersion" fraction).
    if not presets and disp is not None and "range" in cfg.scales:
        tb = int(np.median(cfg.range_time_barriers)) if cfg.range_time_barriers else 20
        fallback = Candidate(idx=-1, scale="range", entry_coef=cfg.range_entry_coef,
                             target_coef=0.5, time_barrier=tb)
        prices = draft_prices_for_candidate(price, speed, disp, fallback, cfg.plr, side, order_type)
        if prices is not None:
            presets.append({
                "kind": "regular", "d2": tb, "win_rate": None, "expectancy": None,
                "expectancy_per_day": None, "efficiency": None, "win_rate_ci": None,
                "efficiency_ci": None, "n_trials": 0, "entry": prices["entry"],
                "stop_loss": prices["stop_loss"], "take_profit": prices["take_profit"],
                "scale": "range", "target_coef": 0.5, "entry_coef": cfg.range_entry_coef,
            })
            reason = reason or "Low confidence — drafted a deterministic dispersion trade."

    candidates = [
        {
            "scale": m.scale,
            "time_barrier": m.time_barrier,
            "target_coef": m.target_coef,
            "entry_coef": m.entry_coef,
            "n_trials": m.n_trials,
            "win_rate": m.win_rate,
            "win_rate_ci": _ci_list(m.win_rate_ci),
            "expectancy_per_day": m.expectancy_per_day,
            "efficiency": m.efficiency,
            "efficiency_ci": _ci_list(m.efficiency_ci),
            "fill_rate": m.fill_rate,
            "preset_kind": m.preset_kind,
            "confident": m.confident,
        }
        for m in rec.candidates
    ]

    return {
        **base,
        "confident": rec.confident,
        "reason": reason,
        "fill_rate": fill_rate,
        "speed": speed,
        "dispersion": disp,
        "presets": presets,
        "candidates": candidates,
    }
