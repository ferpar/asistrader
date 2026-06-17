# Automated Strategies — Implementation Plan

Design rationale lives in [`docs/automated-strategies.md`](./docs/automated-strategies.md). This is the build sequence.

## Scope

A pluggable "automated strategy" that drafts a trade (entry/TP/SL) for a ticker, human-in-the-loop, and locks the generating `strategy_id` onto the trade for per-strategy attribution. First strategy: **historical-expected-days**, a triple-barrier historical sweep that recommends `D2` (holding/target horizon) via three presets. Sizing (`units`) stays with the existing risk attribution.

Work is backend-heavy (the engine) with a frontend draft/confirm flow at the end. Phases are ordered so the **riskiest piece — the engine — is built and tested in isolation first**.

---

## Phase 0 — Model & migrations (backend)

### 0.1 `Strategy` extensions
`backend/src/asistrader/models/db.py` — add to `Strategy`:
- `automated = Column(Boolean, default=False, nullable=False, server_default=...)`
- `params = Column(JSON, nullable=True)` (`JSON` already imported)

`params` shape (for historical-expected-days):
```jsonc
{
  "engine": "historical_expected_days",
  "plr_default": 1.5,
  "d1_default": 1,
  "d2_range": [1, 60],
  "lookback_years": 3,
  "recency_weighted": true,
  "order_type_default": "limit",
  "time_in_effect_default": "gtd",
  "gates": { "min_margin_over_breakeven": 0.05, "min_effective_samples": 30 }
}
```

### 0.2 `Trade` extensions
Add to `Trade`:
- `followed_faithfully = Column(Boolean, nullable=True)` (null until opened via an automated strategy)
- `strategy_snapshot = Column(JSON, nullable=True)` — chosen preset, `plr_used`, `d1`, `d2`, `expected_winrate`, `expected_efficiency`, `expected_fill_rate`, CI bounds, `sweep_last_bar_date`.

### 0.3 Schemas
`backend/src/asistrader/models/schemas.py` — extend `StrategySchema`/`StrategyCreateRequest`/`StrategyUpdateRequest` with `automated` + `params`; extend the trade schemas with `followed_faithfully` + `strategy_snapshot`.

### 0.4 Migration
`backend/alembic/versions/<new>_automated_strategies.py` — add the four columns. All nullable / defaulted; downgrade drops them.

**PR1**: model + schemas + migration only. No behavior yet.

---

## Phase 1 — The sweep engine (backend, pure, vectorized)

New package `backend/src/asistrader/services/strategies/`:
```
strategies/
├── __init__.py
├── registry.py                 # name -> derivation fn (pe/sl/tp method hooks)
├── speed.py                    # point-in-time trailing avgChangePct from MarketData
├── historical_expected_days.py # the sweep engine
└── barriers.py                 # triple-barrier scoring (wraps sltp_detection_service)
```

### 1.1 Speed (`speed.py`)
Point-in-time trailing `avgChangePct` per date from a ticker's `MarketData` close series, in pandas. Mirror the formula in `frontend/src/domain/radar/indicators.ts`. **Trailing-only** (window ends at `t`) — assert no lookahead in tests.

### 1.2 Entry geometry (in `historical_expected_days.py`)
`entry = P·(1 ± speed×D1)`, sign from `(side, order_type)` per the table in the design doc. One function, reused live and per-trial.

### 1.3 Fill gate
Given an entry level + `time_in_effect` window, find the first bar whose `high`/`low` touches it; else no-fill. Track fill / no-fill per trial.

### 1.4 Barrier scoring (`barriers.py`)
`TP = entry·(1+speed·D2)`, `SL` from PLR, vertical barrier at `D2` bars. Walk forward via **`sltp_detection_service`** touch logic (reuse — same convention live and backtest), long & short. Outcome ∈ {win, loss, timeout(mark-to-close)}.

### 1.5 Sweep driver
For a ticker: 3y recency-weighted window of entry dates × `D2 ∈ d2_range`. Vectorize across dates per `D2`. Return per-`D2` arrays: outcomes, returns, realized durations, fill flags.

### 1.6 Tests
`backend/tests/test_services/test_historical_expected_days.py` — synthetic deterministic price fixtures with known outcomes (a monotonic up-path → known TP hits; a gap day → same-bar convention; a never-filled limit → no-fill). Assert no lookahead.

**PR2**: engine + tests. Pure, no API.

---

## Phase 2 — Recommendation & gating (backend, pure)

`strategies/recommend.py`:
- Aggregate per-`D2` → fill-rate, win-rate, expectancy, expectancy/day curves.
- **Block/stationary bootstrap** over entry dates → CIs for each metric.
- Objectives → presets: **regular** = max `expectancy/day × fill-rate`; **conservative** = max win-rate/fill-rate; **aggressive** = max velocity (shorter `D2`).
- **Plateau** selection (prefer stable regions over spikes).
- **Gates**: surface a preset only if its efficiency CI clears the 40% (`1/(1+PLR)`) floor by `min_margin_over_breakeven` and separates from neighbors, with ≥ `min_effective_samples`. Else return a `low_confidence` verdict.

Tests: known-distribution fixtures → expected preset selection; thin-sample fixture → `low_confidence`.

**PR3**: recommendation + gating + tests.

---

## Phase 3 — Runtime: endpoint + cache (backend)

### 3.1 Result cache / record
A per-`(ticker, params-hash, last_market_data_date)` cache of sweep+recommendation output. Start as a `sweep_results` table (ticker, params_hash, last_bar_date, payload JSON, computed_at); invalidate when a newer bar exists.

### 3.2 Endpoint
`backend/src/asistrader/api/strategies.py` — `POST /strategies/{id}/draft` with `{ ticker, plr?, d1?, order_type?, time_in_effect? }`. Resolves params (PLR override → strategy default → 1.5), checks cache, computes on miss. Returns presets + stats + CIs + drafted prices, or a `low_confidence` verdict.

### 3.3 Off-event-loop
Run the sweep via `run_in_threadpool` (or a `ProcessPoolExecutor`) so it never blocks a worker.

**PR4**: endpoint + cache + threadpool.

---

## Phase 4 — Strategy semantics + draft/confirm UX (frontend)

### 4.1 Strategy admin
Strategy CRUD UI: `automated` toggle + `params` editor. Domain types/mappers for the new fields.

### 4.2 Draft flow
In the trade-creation path (`frontend/src/hooks/useTradeCreation.ts`, `TradeCreationModal`):
- Strategy selector; choosing an automated strategy calls `POST /strategies/{id}/draft`.
- **PLR input** (default 1.5) → re-draft on change.
- Render the three preset cards (D2, win-rate, expectancy, fill-rate, CI, confidence); default **regular**. On `low_confidence`, show the reason and don't auto-fill.
- Selecting a preset **pre-fills the existing modal** (entry/TP/SL/order fields); `units` from the existing risk attribution; `strategy_id` stamped and **locked**.
- Prices **nudgeable** → set `followed_faithfully` accordingly; persist `strategy_snapshot` on confirm.

Pure logic (preset math, formatting) → `@asistrader/domain` package (per [`domain-package-extraction`] convention; Vite needs explicit barrel exports).

**PR5**: frontend draft/confirm.

---

## Phase 5 — Docs & follow-ups

- End-user docs: preset definitions + the 40% / capital-efficiency rationale (spine is in the design doc).
- Later: transaction costs in the sim; realized-vs-expected analytics from `strategy_snapshot`; walk-forward validation (v2); backfill `Ticker.trend_mean_growth`/`std`/`probability` from the sweep.

---

## Assumptions / open

- **Long-side first** for v1; short uses the mirrored geometry (already tabulated) but validate separately.
- **D2 in trading bars**, not calendar days; all counting off the `MarketData` index.
- **Single drift point estimate** (chosen earlier) — spread is empirical from the date sweep, not a 50d/5d band.
- Reusing `sltp_detection_service`'s same-bar (TP-and-SL-in-one-bar) convention; confirm it's the worst-case/intended one during Phase 1.
- Cache is per resolved-params hash; a non-default PLR re-sweeps once and caches.
