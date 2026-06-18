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

from .engines import get_engine
from .historical_expected_days import SweepConfig, draft_prices, run_sweep
from .recommend import RecommendConfig, recommend
from .speed import trailing_avg_change_pct


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

    Uses the cache when fresh; otherwise computes, caches, and returns.
    """
    ticker = overrides["ticker"]
    sweep_cfg, rec_cfg, side, order_type, params_hash = _resolve(strategy, overrides)
    breakeven = 1.0 / (1.0 + sweep_cfg.plr)

    engine_id = (strategy.params or {}).get("engine", "historical_expected_days")
    if get_engine(engine_id) is None:
        return {
            "confident": False,
            "reason": f"Unknown strategy engine '{engine_id}'.",
            "breakeven_win_rate": breakeven,
            "fill_rate": 0.0,
            "ticker": ticker,
            "last_bar_date": None,
            "speed": None,
            "presets": [],
        }

    _, last_bar = get_data_bounds(db, ticker)
    if last_bar is None:
        return {
            "confident": False,
            "reason": f"No market data for {ticker}.",
            "breakeven_win_rate": breakeven,
            "fill_rate": 0.0,
            "ticker": ticker,
            "last_bar_date": None,
            "speed": None,
            "presets": [],
        }

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
        return cached.payload

    payload = _compute(db, ticker, sweep_cfg, rec_cfg, side, order_type, breakeven, last_bar)

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
