# Automated Strategies — Design

## Overview

Opening a trade is one of the biggest manual bottlenecks today: the user hand-assembles entry, sizing, and a (possibly layered) SL/TP ladder for every trade. **Automated strategies** push that assembly onto the system — the user picks a strategy on a ticker, the system drafts a concrete trade (entry / TP / SL), and the user reviews and confirms. The trade is then stamped with the strategy that produced it, so realized P&L becomes attributable *per strategy*.

This directly realizes principles already in [`domain-model.md`](./domain-model.md): *"track what strategy was actually used,"* *"recommendations vs actual usage are separate,"* and strategies as pluggable. The domain model's diagram already distinguishes a Ticker's **recommended** strategy from a Trade's **actual (locked)** one — automated strategies are what make that "locked actual" meaningful.

Two design goals, intertwined:
1. **Reduce manual load** when opening trades (automate the price assembly).
2. **Earn the `strategy` field.** Automation produces consistency; logging the generating strategy turns the barely-used `strategy` property into the key for per-strategy performance attribution. Automate → standardize → attribute → learn.

Autonomy is **human-in-the-loop**: the system drafts, the user confirms.

---

## Core concepts

### Strategy = tag + executable object

`Strategy` already carries `name`, `description`, and three method slots — `pe_method`, `sl_method`, `tp_method` (see `backend/src/asistrader/models/db.py`). Those slots are the hook:

- **Manual strategy** — the slots are descriptive labels; the user freely tags a trade and can change it later.
- **Automated strategy** — the slots name **registered executable derivations**, and a trade opened through it has its `strategy_id` **set and locked**.

New model surface is small: an `automated` flag and a JSON `params` bag on `Strategy`.

### Two layers: synthesizer vs. optimizer

- **Trade synthesizer (deterministic, no simulation).** Given `(entry basis, target gain, PLR, days)`, produce entry / SL / TP and the exit ladder. Strategy-agnostic; keeps the system polyvalent. Position size (`units`) is **not** part of this — it stays with the existing risk attribution (driven by the fund-page `risk_pct`).
- **Strategy optimizer (the "brain").** Supplies the days/target the synthesizer needs — either manually entered, or recommended by a strategy. The first automated strategy is the optimizer below.

---

## First strategy: "historical-expected-days"

A historical **triple-barrier sweep** (TP / SL / time barriers; cf. López de Prado). It replays real history and, for every `(entry date × D2)` combination, launches a hypothetical trade, walks the actual subsequent path, and records the outcome. The "Monte Carlo" flavor is the fan-out over dates and `D2`, not synthetic price generation; the outcome spread comes purely from sweeping entry dates (single drift point estimate).

### Inputs and the speed operator

- **Speed** = trailing `avgChangePct` (per-day %), computed **point-in-time**: a trial entered on date `t` uses only the window ending at `t` (no lookahead). Mirrors the formula already in `frontend/src/domain/radar/indicators.ts`, recomputed backend-side over full daily history.
- **PLR** = reward : risk ratio, a strategy param (default **1.5**), **per-draft overridable**.
- **D1** = days for the order to fill (default 1).
- **D2** = the swept free variable.

> **Note:** `Ticker.trend_mean_growth` / `trend_std_deviation` / `probability` are seed-only placeholders today (never computed; `probability` was originally `ai_success_probability`). The sweep should eventually **backfill** them — drift/vol → `trend_mean_growth`/`std`, historical win-rate → `probability` — rather than consume them.

### Trial mechanics

Entry is a deterministic synthesizer step (no simulation), reused both live and inside each trial. Direction comes from `order_type × side` — both `LIMIT` and `STOP` are supported (the `OrderType` enum already exists), which removes any need to infer offset direction from drift:

| Side | Order type | Entry (P = close, k = speed×D1) | Fills when |
|------|-----------|--------------------------------|------------|
| Long | LIMIT (buy dip) | `P·(1 − k)` (below) | a later `low ≤ entry` |
| Long | STOP (buy breakout) | `P·(1 + k)` (above) | a later `high ≥ entry` |
| Short | LIMIT (sell strength) | `P·(1 + k)` (above) | a later `high ≥ entry` |
| Short | STOP (sell breakdown) | `P·(1 − k)` (below) | a later `low ≤ entry` |
| either | MARKET | `P` (immediate) | always (`D1 = 0`) |

Once an order fills:

- **`D2` sizes the TP and is the time barrier.** `target% = speed × D2`; `TP = entry·(1 + target%)`; `SL = entry·(1 − target%/PLR)` (long; mirrored for short). Vertical barrier = `D2` trading bars after fill.
- **Scoring** walks forward bar-by-bar using `high`/`low` (we store **unadjusted** OHLCV on purpose — see `market_data_service.py`), reusing `sltp_detection_service` for touch detection (long & short, same-bar convention). Three outcomes: **win** (TP first), **loss** (SL first), **timeout** (neither within `D2`, marked-to-close at the barrier).
- **Fills can fail.** A `LIMIT` below a rising stock often never triggers. The fill window is driven by `time_in_effect` (`DAY` → next bar; `GTD` → until the gtd horizon; `GTC` → capped). **Fill-rate** is a first-class output — a 65%-win config that only fills 8% of the time is a mirage.

Counting is always in **trading bars** off the price series' own index, so weekends/holidays simply don't exist (no calendar-day bugs).

### Why the objective isn't obvious

With PLR fixed, a filled trial wins `g` or loses `g/PLR`, where `g = speed×D2`:

```
expectancy ≈ g · [ winrate − (1 − winrate)/PLR ]   →  at PLR 1.5:  g · (1.667·winrate − 0.667)
```

Two consequences:
- **Break-even win-rate = `1/(1+PLR)` = 40%.** That's the random-walk noise floor; the edge is how far a ticker's drift pushes win-rate above it. (This is also why a minimum-gain `Tmin` isn't needed to fix a probability artifact — win-rate is scale-invariant at fixed PLR under a random walk; the real reason to avoid tiny trades is transaction costs, deferred.)
- **Expectancy scales with `g`, i.e. with `D2`.** So raw win-rate or raw expectancy both run away to the longest window. Neither is a valid objective alone.

### Recommendation & presets

The sweep yields three curves over `D2`: **fill-rate(D2)**, **win-rate(D2)**, **expectancy(D2)**. The presets each optimize a *different* normalized metric:

- **Regular** → max **capital-efficiency**: `expectancy / holding-day × fill-rate` (return per unit capital-time per opportunity).
- **Conservative** → max **win-rate / fill-rate** (safety; give it room).
- **Aggressive** → max **velocity / turnover** (shorter `D2`, smaller faster targets).

The winners'-duration standard deviation is a **confidence band**, not the objective.

---

## Statistical rigor

The binding constraint is **independent sample count**, not CPU. Consecutive entry dates produce massively overlapping forward windows (a trade entered Monday and one Tuesday with `D2=30` share 29 days of the same path), so raw trial count badly overstates information. Non-overlapping windows ≈ `history / D2`, which doubly penalizes large `D2`:

| Lookback | D2 = 10 | D2 = 30 | D2 = 60 |
|---|---|---|---|
| 3y (~750 bars) | ~75 | ~25 | ~12 |
| 5y (~1250 bars) | ~125 | ~42 | ~21 |

Decisions:

- **Lookback: 3 years, recency-weighted.** Balances sample count against regime drift (older data may be a different volatility/drift regime).
- **Keep all overlapping samples, but report honest confidence** via a **block / stationary bootstrap over entry dates**, so CIs reflect the *effective* (not inflated) sample size.
- **Gate recommendations on the honest CI.** A preset is surfaced only if its efficiency CI (a) clears the 40% break-even floor by a margin and (b) separates from neighboring `D2`. Otherwise → "low confidence / not enough history," never a falsely precise number.
- **Plateau over spike.** Prefer a stable region of good efficiency to a lone noisy maximum (winner's-curse mitigation). Full walk-forward / out-of-sample validation is **v2**.

---

## Runtime

Python, **on-demand per-ticker** (not a universe batch — there is no scheduler in the repo; market-data refresh is a manual `force_refresh` endpoint, ~130 tickers). Vectorized with pandas (already a backend dependency), a single-ticker sweep is sub-second. Two safeguards keep it off the request's critical path:

- Run **off the event loop** (`run_in_threadpool` / a process pool) so the CPU-bound job never blocks a worker.
- **Cache** keyed on `(ticker, resolved params incl. PLR, last_market_data_date)`. Results only change when a new daily bar lands; a repeat draft is an instant lookup, and a non-default PLR is simply a different cache entry that re-sweeps once.

---

## Model & data

| Where | Change |
|-------|--------|
| `Strategy` | add `automated: bool`, `params: JSON` (PLR default, D1 default, D2 range, lookback, order/TIF defaults, confidence-gate thresholds). The `JSON` type is already imported in `db.py`. |
| `Trade` | add `followed_faithfully: bool` (suggested prices taken as-is vs nudged) and a `strategy_snapshot: JSON` (chosen preset, PLR used, D1/D2, expected win-rate / efficiency / fill-rate, CI bounds, sweep data-version). |
| derivation registry | a small registry mapping `pe_method`/`sl_method`/`tp_method` names → executable functions. The first automated strategy registers: pe = speed-offset entry, tp = historical-expected-days, sl = PLR. |

**Nudgeable, but flagged.** Suggested prices are pre-filled into the existing trade-creation modal with `strategy_id` locked; the user may nudge entry/TP/SL, and `followed_faithfully` records whether they did, so attribution can separate pure-strategy P&L from hand-tweaked trades.

**Snapshot the expectations.** The draft-time stats are stored on the trade because they can't be reconstructed later (the sweep moves as data accrues). This is what enables realized-vs-expected analysis per strategy — the whole payoff of stamping the strategy.

**PLR vs `risk_pct` are orthogonal.** PLR shapes *geometry* (`SL = TP/PLR`, break-even `1/(1+PLR)`); the fund-page `UserFundSettings.risk_pct` (≈0.02) decides *how much capital*. Sizing is an **investment cap**, computed frontend-side (`useTradeCreation.ts` `suggestedUnits` + `computeBalance.ts`): `units = floor((equity × risk_pct) / entry)` — there is **no SL term** in sizing (it's a max-investment %, not stop-distance risk). So PLR doesn't enter sizing at all; the two are fully independent.

---

## Deferred / open

- **Transaction costs** baked into the simulated outcome (the principled replacement for a `Tmin` floor).
- **Realized-vs-expected analytics** dashboard, fed by `strategy_snapshot`.
- **Walk-forward / out-of-sample validation** (v2).
- **Raising statistical confidence** — cross-sectional pooling across the ticker universe, volatility-normalized barriers, return-model Monte Carlo, and a vol/drift first-passage prior. The v1 engine is deliberately assumption-light (replays the one realized path), so it's honest but low-powered on thin single-ticker history. Full analysis and ranked options in [`automated-strategies-confidence.md`](./automated-strategies-confidence.md).
- **Backfilling** `Ticker.trend_mean_growth` / `trend_std_deviation` / `probability` from the sweep.
- **End-user documentation** — the preset definitions plus the 40% / capital-efficiency rationale above are its spine.

See [`../automated-strategies-plan.md`](../automated-strategies-plan.md) for the phased implementation plan.
